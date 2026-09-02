import csv
import io
import os

from flask import Flask, Response, abort, flash, jsonify, redirect, render_template, request, url_for

import db
import ipam

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

db.init_db()


@app.route("/")
def index():
    with db.db_cursor() as cur:
        cur.execute(
            """
            SELECT n.id, n.name, n.cidr, n.created_at,
                   COUNT(h.id) FILTER (WHERE h.hostname != '' OR h.description != '' OR h.mac_address != '') AS used_count
            FROM networks n
            LEFT JOIN hosts h ON h.network_id = n.id
            GROUP BY n.id
            ORDER BY n.created_at DESC
            """
        )
        networks = cur.fetchall()

    network_rows = []
    for n in networks:
        try:
            net = ipam.parse_network(n["cidr"])
            total = ipam.usable_host_count(net)
        except ipam.InvalidCIDR:
            total = 0
        network_rows.append({**dict(n), "total": total})

    return render_template("index.html", networks=network_rows)


@app.route("/networks", methods=["POST"])
def create_network():
    name = request.form.get("name", "").strip()
    cidr = request.form.get("cidr", "").strip()

    if not name:
        flash("Network name is required.", "error")
        return redirect(url_for("index"))

    try:
        network = ipam.parse_network(cidr)
    except ipam.InvalidCIDR as exc:
        flash(f"Invalid network: {exc}", "error")
        return redirect(url_for("index"))

    count = ipam.usable_host_count(network)
    if count > ipam.MAX_HOSTS:
        flash(
            f"That network has {count} usable addresses, which is above the {ipam.MAX_HOSTS} limit. "
            "Use a smaller subnet (e.g. /20 or smaller).",
            "error",
        )
        return redirect(url_for("index"))

    try:
        with db.db_cursor() as cur:
            cur.execute(
                "INSERT INTO networks (name, cidr) VALUES (?, ?)",
                (name, str(network)),
            )
            network_id = cur.lastrowid
    except db.sqlite3.IntegrityError:
        flash(f"A network with CIDR {network} already exists.", "error")
        return redirect(url_for("index"))

    flash(f"Created network {name} ({network}).", "success")
    return redirect(url_for("network_detail", network_id=network_id))


@app.route("/networks/<int:network_id>")
def network_detail(network_id):
    network_row, network = _get_network_or_404(network_id)

    with db.db_cursor() as cur:
        cur.execute(
            """
            SELECT ip_address, hostname, description, mac_address, updated_at FROM hosts
            WHERE network_id = ? AND (hostname != '' OR description != '' OR mac_address != '')
            """,
            (network_id,),
        )
        assigned = {row["ip_address"]: dict(row) for row in cur.fetchall()}

    all_ips = ipam.usable_hosts(network)
    host_rows = [
        {
            "ip": ip,
            "hostname": assigned[ip]["hostname"],
            "description": assigned[ip]["description"],
            "mac_address": assigned[ip]["mac_address"],
        }
        for ip in all_ips
        if ip in assigned
    ]
    free_ips = [ip for ip in all_ips if ip not in assigned]

    return render_template(
        "network.html",
        network=network_row,
        cidr=str(network),
        hosts=host_rows,
        free_ips=free_ips,
        used_count=len(host_rows),
        total_count=len(all_ips),
    )


@app.route("/networks/<int:network_id>/hosts", methods=["POST"])
def upsert_host(network_id):
    network_row, network = _get_network_or_404(network_id)

    payload = request.get_json(silent=True) or request.form
    ip = (payload.get("ip") or "").strip()
    hostname = (payload.get("hostname") or "").strip()
    description = (payload.get("description") or "").strip()
    mac_raw = (payload.get("mac_address") or "").strip()

    if not ipam.is_ip_in_network(network_row["cidr"], ip):
        return jsonify({"error": "That IP is not a valid usable address in this network."}), 400

    try:
        mac_address = ipam.normalize_mac(mac_raw)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not (hostname or description or mac_address):
        with db.db_cursor() as cur:
            cur.execute(
                "DELETE FROM hosts WHERE network_id = ? AND ip_address = ?",
                (network_id, ip),
            )
        return jsonify({"ok": True, "ip": ip, "removed": True})

    with db.db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO hosts (network_id, ip_address, hostname, description, mac_address, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(network_id, ip_address) DO UPDATE SET
                hostname=excluded.hostname,
                description=excluded.description,
                mac_address=excluded.mac_address,
                updated_at=datetime('now')
            """,
            (network_id, ip, hostname, description, mac_address),
        )

    return jsonify(
        {
            "ok": True,
            "ip": ip,
            "hostname": hostname,
            "description": description,
            "mac_address": mac_address,
            "removed": False,
        }
    )


@app.route("/networks/<int:network_id>/hosts/remove", methods=["POST"])
def remove_host(network_id):
    _get_network_or_404(network_id)
    payload = request.get_json(silent=True) or request.form
    ip = (payload.get("ip") or "").strip()

    with db.db_cursor() as cur:
        cur.execute(
            "DELETE FROM hosts WHERE network_id = ? AND ip_address = ?",
            (network_id, ip),
        )

    return jsonify({"ok": True, "ip": ip, "removed": True})


@app.route("/networks/<int:network_id>/hosts/export.csv")
def export_hosts(network_id):
    network_row, network = _get_network_or_404(network_id)

    with db.db_cursor() as cur:
        cur.execute(
            """
            SELECT ip_address, hostname, description, mac_address FROM hosts
            WHERE network_id = ? AND (hostname != '' OR description != '' OR mac_address != '')
            """,
            (network_id,),
        )
        assigned = {row["ip_address"]: row for row in cur.fetchall()}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ip", "hostname", "description", "mac_address"])
    for ip in ipam.usable_hosts(network):
        if ip in assigned:
            row = assigned[ip]
            writer.writerow([ip, row["hostname"], row["description"], row["mac_address"]])

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in network_row["name"]).strip("_") or "network"
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}-hosts.csv"'},
    )


@app.route("/networks/<int:network_id>/hosts/import", methods=["POST"])
def import_hosts(network_id):
    network_row, network = _get_network_or_404(network_id)

    file = request.files.get("file")
    if not file or not file.filename:
        flash("Choose a CSV file to import.", "error")
        return redirect(url_for("network_detail", network_id=network_id))

    try:
        content = file.stream.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        flash("Could not read that file as UTF-8 text.", "error")
        return redirect(url_for("network_detail", network_id=network_id))

    reader = csv.DictReader(io.StringIO(content))
    field_map = {f.strip().lower(): f for f in (reader.fieldnames or [])}
    if "ip" not in field_map:
        flash('CSV must have a header row including an "ip" column.', "error")
        return redirect(url_for("network_detail", network_id=network_id))

    def field(row, name):
        key = field_map.get(name)
        return (row.get(key, "") or "").strip() if key else ""

    imported = 0
    skipped = []
    with db.db_cursor() as cur:
        for i, row in enumerate(reader, start=2):  # header is row 1
            if not any((row or {}).values()):
                continue

            ip = field(row, "ip")
            if not ip:
                continue

            if not ipam.is_ip_in_network(network_row["cidr"], ip):
                skipped.append(f"row {i}: {ip!r} is not a usable address in this network")
                continue

            try:
                mac_address = ipam.normalize_mac(field(row, "mac_address"))
            except ValueError:
                skipped.append(f"row {i}: invalid MAC address for {ip}")
                continue

            hostname = field(row, "hostname")
            description = field(row, "description")

            if not (hostname or description or mac_address):
                continue

            cur.execute(
                """
                INSERT INTO hosts (network_id, ip_address, hostname, description, mac_address, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(network_id, ip_address) DO UPDATE SET
                    hostname=excluded.hostname,
                    description=excluded.description,
                    mac_address=excluded.mac_address,
                    updated_at=datetime('now')
                """,
                (network_id, ip, hostname, description, mac_address),
            )
            imported += 1

    message = f"Imported {imported} host(s)."
    if skipped:
        shown = "; ".join(skipped[:5])
        more = f" (+{len(skipped) - 5} more)" if len(skipped) > 5 else ""
        message += f" Skipped {len(skipped)}: {shown}{more}"
    flash(message, "success" if imported else "error")
    return redirect(url_for("network_detail", network_id=network_id))


@app.route("/networks/<int:network_id>/delete", methods=["POST"])
def delete_network(network_id):
    _get_network_or_404(network_id)
    with db.db_cursor() as cur:
        cur.execute("DELETE FROM networks WHERE id = ?", (network_id,))
    flash("Network deleted.", "success")
    return redirect(url_for("index"))


def _get_network_or_404(network_id):
    with db.db_cursor() as cur:
        cur.execute("SELECT * FROM networks WHERE id = ?", (network_id,))
        row = cur.fetchone()
    if row is None:
        abort(404)
    try:
        network = ipam.parse_network(row["cidr"])
    except ipam.InvalidCIDR:
        abort(500)
    return row, network


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host=host, port=port, debug=debug)
