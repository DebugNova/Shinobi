# SHINOBI ARENA: the VPS's networking details

Moved out of CLAUDE.md (its "The VPS" section keeps the summary: live link, access, setup, deploy). Read this before
touching DNS, the public IP, or when the box is unreachable after an update.

- **Domain:** sslip.io (free, no account) resolves any name containing the IP; if the IP changes, so do the names (update
  the Caddyfile, deploy.mjs's HOST and printed link, README, CLAUDE.md). A nicer free name needs the owner's DuckDNS login
  (duckdns.org: pick a name, IP 185.2.49.69), then swap the name in the Caddyfile. DNS never affects ping (one lookup per
  page load).
- **The public IP is not on the NIC:** it sits on `lo` and arrives over a WireGuard tunnel (`sv-transit`,
  `/etc/wireguard/sv-transit.conf`, peer 148.113.16.59:51820; brought up at boot by Shulker, not the inactive wg-quick@
  unit). Replies go back through it only thanks to the tunnel's PostUp rules: `fwmark 0x64/0xff lookup 100` (+ mangle
  CONNMARK rules) and `from 185.2.49.69 lookup 100` (table 100 = `default dev sv-transit`). The first `apt upgrade`
  restarted systemd-networkd, which deletes rules it didn't create: SSH timed out (SYN in via sv-transit, SYN-ACK out via
  enp0s3) while ping still answered (not ufw). Fixed by `/etc/systemd/networkd.conf.d/10-keep-shulker-routes.conf`
  (`ManageForeignRoutingPolicyRules=no`, `ManageForeignRoutes=no`); survives reboots (tested twice). Unreachable after an
  update? Check `ip rule` first (VNC console).
- **Ping ~80 ms from the owner** (84 in game): all in India, but the IP is announced from OVH **Mumbai** (148.113.16.59,
  ~53 ms from the owner) and tunnelled ~27 ms on to Dadri; the datacentre directly is ~40 ms from the owner (the
  checkout's 13-16 ms wasn't measured from the owner's laptop). The owner is asking Shulker support for a public IP routed
  in Dadri (bridged) or port forwards for TCP 80/443 on a Dadri IP (would save ~35-40 ms); when it arrives, move the Caddy
  names, ufw and docs to it.
- **Packet loss via Mumbai** (2026-09-28): 10-16% from the owner to 148.113.16.59 and 185.2.49.69 (0% to 1.1.1.1 /
  8.8.8.8), so downloads crawl at ~40 KB/s and a first load takes minutes. Not the VM (it fetches its own public link
  at full speed) and not the tunnel MTU (1420: DF pings pass up to that). Diagnose with `ping -n 30 148.113.16.59`
  from the laptop; the cure is a Dadri-side IP (above).
