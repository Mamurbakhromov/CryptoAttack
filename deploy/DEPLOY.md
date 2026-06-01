# Deploy yo'riqnomasi — signal.saraftech.com

VM: `188.245.185.218` · Domen: `signal.saraftech.com` (GoDaddy A-record allaqachon shu IP ga yo'naltirilgan)

Arxitektura: bitta Node (Fastify) server `127.0.0.1:3001` da API + SSE + statik
frontend (`apps/web/dist`) ni xizmat qiladi. Oldida **nginx** HTTPS bilan reverse
proxy va **HTTP Basic Auth** himoyasi. Ma'lumotlar **docker** ichidagi
TimescaleDB/Postgres'ga yoziladi. Process'ni **systemd** boshqaradi.

```
Internet → nginx (443, TLS + Basic Auth) → 127.0.0.1:3001 (systemd: node) → docker postgres (127.0.0.1:5432)
```

---

## 0. Lokalda: GitHub'ga push qilish

Bu repo ildizida (lokal mashinangizda):

```bash
git add .
git commit -m "Add production deploy setup (nginx, systemd, env, scripts)"
git push origin main
```

> `.env` git'ga **tushmaydi** (`.gitignore`). Faqat `.env.production.example`
> push bo'ladi — sirlar VM da to'ldiriladi.

---

## 1. VM ni tayyorlash (bir martalik)

VM ga kiring:

```bash
ssh root@188.245.185.218
```

### 1.1 Tizimni yangilash va asosiy paketlar

```bash
apt update && apt upgrade -y
apt install -y curl git ufw ca-certificates gnupg apache2-utils
```

`apache2-utils` — `htpasswd` uchun (Basic Auth paroli).

### 1.2 Node.js 20 (NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version   # v20.x bo'lsin
```

### 1.3 pnpm

```bash
npm install -g pnpm@9.15.4
pnpm --version
```

### 1.4 Docker + compose plugin

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

### 1.5 Nginx va Certbot

```bash
apt install -y nginx
apt install -y certbot python3-certbot-nginx
```

### 1.6 Deploy foydalanuvchisi

Xizmatni root'dan emas, alohida foydalanuvchidan ishlatamiz:

```bash
adduser --system --group --home /opt/cryptoattack --shell /bin/bash cryptoattack
usermod -aG docker cryptoattack
# deploy.sh ichida `sudo systemctl restart` ishlashi uchun:
echo 'cryptoattack ALL=(root) NOPASSWD: /usr/bin/systemctl restart cryptoattack-dashboard, /usr/bin/systemctl status cryptoattack-dashboard' \
  > /etc/sudoers.d/cryptoattack
chmod 440 /etc/sudoers.d/cryptoattack
```

### 1.7 Firewall (UFW)

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'   # 80 + 443
ufw --force enable
ufw status
```

> Postgres (5432) va backend (3001) faqat `127.0.0.1` da tinglaydi — tashqaridan
> ochiq emas, UFW da port ochish shart emas.

---

## 2. Repozitoriyani klonlash

```bash
# repo'ni /opt/cryptoattack ichiga klonlaymiz
sudo -u cryptoattack git clone git@github.com:Mamurbakhromov/CryptoAttack.git /opt/cryptoattack
# (SSH kalit bo'lmasa HTTPS bilan:)
# sudo -u cryptoattack git clone https://github.com/Mamurbakhromov/CryptoAttack.git /opt/cryptoattack
cd /opt/cryptoattack
```

Egalik to'g'ri ekanini tekshiring:

```bash
chown -R cryptoattack:cryptoattack /opt/cryptoattack
```

---

## 3. `.env` ni sozlash

```bash
sudo -u cryptoattack cp .env.production.example .env
sudo -u cryptoattack nano .env
```

Kamida quyidagilarni o'zgartiring:

| O'zgaruvchi | Qiymat |
|---|---|
| `CRYPTOATTACK_API_KEY` | **Haqiqiy** CryptoAttack kaliti |
| `POSTGRES_PASSWORD` | Uzun random parol |
| `DATABASE_URL` | Parol qismi `POSTGRES_PASSWORD` bilan **aynan** bir xil |

Random parol generatsiya:

```bash
openssl rand -hex 24
```

> `WEB_ORIGIN=https://signal.saraftech.com` va `SERVER_HOST=127.0.0.1` allaqachon
> shabloncha to'g'ri. App-token auth o'chiq (`DASHBOARD_AUTH_ENABLED=false`) —
> himoya nginx Basic Auth darajasida (10-bo'lim).

---

## 4. Postgres'ni ishga tushirish va migratsiya

```bash
cd /opt/cryptoattack
sudo -u cryptoattack docker compose up -d postgres
sudo -u cryptoattack docker compose ps        # healthy bo'lishini kuting
```

Bog'liqliklar, build va migratsiya:

```bash
sudo -u cryptoattack pnpm install --frozen-lockfile
sudo -u cryptoattack pnpm build
sudo -u cryptoattack pnpm db:migrate
sudo -u cryptoattack pnpm db:status            # versiyani ko'rsatadi
```

---

## 5. Backend'ni systemd xizmati sifatida o'rnatish

```bash
sudo cp deploy/cryptoattack-dashboard.service /etc/systemd/system/
# node yo'lini tekshiring (kerak bo'lsa unit ichidagi ExecStart ni tahrirlang):
which node                                     # /usr/bin/node bo'lsin
sudo systemctl daemon-reload
sudo systemctl enable --now cryptoattack-dashboard
sudo systemctl status cryptoattack-dashboard
```

Lokal tekshiruv (VM ichida):

```bash
curl http://127.0.0.1:3001/health
```

`{"ok":true,...}` qaytsa — backend tayyor.

---

## 6. Nginx reverse proxy

```bash
sudo cp deploy/nginx/signal.saraftech.com.conf /etc/nginx/sites-available/signal.saraftech.com
sudo ln -s /etc/nginx/sites-available/signal.saraftech.com /etc/nginx/sites-enabled/
# standart default saytni o'chirish (ixtiyoriy):
sudo rm -f /etc/nginx/sites-enabled/default
```

### 6.1 Basic Auth paroli

```bash
sudo htpasswd -c /etc/nginx/.htpasswd-signal admin
# parolni kiriting. Yana foydalanuvchi qo'shish: htpasswd (-c siz) /etc/nginx/.htpasswd-signal user2
```

### 6.2 Tekshirish va reload

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. HTTPS sertifikat (Let's Encrypt)

DNS tarqalganini tekshiring (IP `188.245.185.218` chiqishi kerak):

```bash
dig +short signal.saraftech.com
```

Keyin:

```bash
sudo certbot --nginx -d signal.saraftech.com
```

Certbot 443 (TLS) blokini va 80→443 redirectni avtomatik qo'shadi. Avtomatik
yangilanish allaqachon sozlangan (`systemctl list-timers | grep certbot`).

---

## 8. Yakuniy tekshiruv

Brauzerda `https://signal.saraftech.com` oching — Basic Auth login so'raydi,
keyin dashboard ochiladi. Realtime SSE oqimi ulanganini StatusBar'dan ko'ring.

Terminaldan:

```bash
curl -u admin:PAROL https://signal.saraftech.com/api/status
curl https://signal.saraftech.com/health      # auth'siz ishlaydi
```

---

## 9. Keyingi yangilanishlar (kod o'zgarganda)

Lokalda push qilgach, VM da:

```bash
cd /opt/cryptoattack
sudo -u cryptoattack bash deploy/deploy.sh
```

Skript: `git pull` → postgres up → `pnpm install` → `pnpm build` →
`pnpm db:migrate` → `systemctl restart` → health check.

---

## 10. Foydali buyruqlar

```bash
# Loglar (realtime)
journalctl -u cryptoattack-dashboard -f

# Xizmat holati / restart
sudo systemctl restart cryptoattack-dashboard
sudo systemctl status cryptoattack-dashboard

# Postgres
cd /opt/cryptoattack && sudo -u cryptoattack docker compose ps
sudo -u cryptoattack docker compose logs -f postgres

# Storage / worker holati
curl http://127.0.0.1:3001/api/storage/status
curl http://127.0.0.1:3001/api/workers/status

# Nginx
sudo nginx -t && sudo systemctl reload nginx
sudo tail -f /var/log/nginx/error.log
```

---

## 11. Muammolarni bartaraf qilish

| Belgi | Sabab / Yechim |
|---|---|
| `502 Bad Gateway` | Backend ishlamayapti → `journalctl -u cryptoattack-dashboard -e`. Ko'pincha `.env` xato (DB parol mos emas) yoki port band. |
| Dashboard ochiladi-yu, ma'lumot yo'q | `CRYPTOATTACK_API_KEY` xato yoki `MOCK_CRYPTOATTACK=false` emasligini tekshiring. `/api/status` latency va connection holatini ko'rsatadi. |
| SSE uzilib qoladi | nginx'da `/api/stream` uchun `proxy_buffering off` borligini tekshiring (config'da bor). |
| `db:migrate` xatosi | Postgres healthy emas yoki `DATABASE_URL` paroli `POSTGRES_PASSWORD` bilan mos emas. |
| Certbot xatosi | DNS hali tarqalmagan bo'lishi mumkin — `dig +short signal.saraftech.com`. Port 80 UFW'da ochiqligini tekshiring. |
| Statik UI 404 | `apps/web/dist` yo'q → `pnpm build` qayta yuriting; systemd `WorkingDirectory` apps/server ekanini tekshiring. |

---

## Eslatma — auth haqida

Server ichidagi token auth o'rniga **nginx Basic Auth** ishlatildi, chunki SPA
token bilan ishlashi uchun token brauzer JS bundle'iga joylanishi kerak bo'lardi
(har kim ko'rishi mumkin). Basic Auth butun saytni — UI, API va SSE'ni — bitta
gate orqali yopadi va tokenni oshkor qilmaydi. Agar keyinchalik IP-allowlist yoki
boshqa auth kerak bo'lsa, nginx darajasida qo'shish mumkin.
