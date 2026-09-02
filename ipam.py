import ipaddress
import re

MAX_HOSTS = 4096  # sanity cap so a fat-fingered /8 doesn't try to render millions of rows

MAC_RE = re.compile(r"^([0-9A-Fa-f]{2})[:\-]([0-9A-Fa-f]{2})[:\-]([0-9A-Fa-f]{2})[:\-]([0-9A-Fa-f]{2})[:\-]([0-9A-Fa-f]{2})[:\-]([0-9A-Fa-f]{2})$")


class InvalidCIDR(ValueError):
    pass


def parse_network(cidr: str) -> ipaddress.IPv4Network:
    cidr = (cidr or "").strip()
    try:
        network = ipaddress.ip_network(cidr, strict=True)
    except ValueError as exc:
        raise InvalidCIDR(str(exc)) from exc
    if network.version != 4:
        raise InvalidCIDR("Only IPv4 networks are supported.")
    return network


def usable_host_count(network: ipaddress.IPv4Network) -> int:
    if network.prefixlen >= 31:
        return network.num_addresses
    return network.num_addresses - 2


def usable_hosts(network: ipaddress.IPv4Network):
    if network.prefixlen >= 31:
        return [str(ip) for ip in network]
    return [str(ip) for ip in network.hosts()]


def is_ip_in_network(cidr: str, ip: str) -> bool:
    try:
        network = ipaddress.ip_network(cidr, strict=True)
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr not in network:
        return False
    if network.prefixlen < 31 and addr in (network.network_address, network.broadcast_address):
        return False
    return True


def normalize_mac(mac: str) -> str:
    mac = (mac or "").strip()
    if not mac:
        return ""
    match = MAC_RE.match(mac)
    if not match:
        raise ValueError("Invalid MAC address format. Use e.g. AA:BB:CC:DD:EE:FF")
    return ":".join(g.lower() for g in match.groups())
