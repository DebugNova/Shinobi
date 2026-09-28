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

## Box, access, setup

(Moved verbatim from CLAUDE.md, which keeps a summary.)

- **Live:** **https://shinobi.185-2-49-69.sslip.io** (also http://185.2.49.69:3100). Shulker VPS `games-1`: Eco series (old Intel Xeon V3/V4), 4 vCPU / 8 GB / 50 GB NVMe,
  monthly ~$5.15 (~Rs 484), Ubuntu 24.04, location in1; the VM is in Dadri (Delhi NCR) on a private NIC (enp0s3 10.77.0.18/16, gateway 10.77.0.1, outbound NAT IP
  45.122.121.132); the public IP came from "Attach IP" in the panel. It will host all the owner's games: ARMORY next (port 3000, `armory.185-2-49-69.sslip.io`; its dist
  is ~205 MB and it runs bots on the server), then 3200...: one Caddy block per game, by subdomain (not by path: the games load `/ws`, `/assets`, `/api` from the root).
  Both games read `PORT` and open the WebSocket on `location.host`: no code changes.
- **Access:** `ssh root@185.2.49.69` with the owner's laptop key (`~/.ssh/id_ed25519`, made 2026-09-28, no passphrase; to be backed up). Password login is off
  (`/etc/ssh/sshd_config.d/00-hardening.conf`: keys only, root by key). The root password (Shulker panel, Access) works only on the VNC console `in-1.shulker.in:5939`
  (RFB 3.8, no VNC password: security None); the owner was told to change it (it was pasted in chat). `scripts/debug/vnc.mjs` drives the console (type + screenshot) when
  SSH is lost.
- **Setup:** Node 24 (NodeSource) + pm2 7 as user `kaustab` (`/home/kaustab/games/ecosystem.config.cjs`: shinobi, PORT 3100; `pm2 startup` = starts on boot; logs `su -
  kaustab -c "pm2 logs shinobi"`), the game in `/home/kaustab/games/shinobi`; ufw allows 22, 80, 443, 3100 (close 3100 once nobody uses the raw link). HTTPS: Caddy 2.6.2
  (Ubuntu package; `/etc/caddy/Caddyfile`, one block per game `<name>.185-2-49-69.sslip.io { reverse_proxy 127.0.0.1:<port> }`, `systemctl reload caddy`; Let's Encrypt
  automatic; no measurable latency).
