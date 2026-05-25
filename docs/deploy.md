# 배포 가이드 — Oracle Cloud (OL9 + Podman + systemd)

봇별 독립 디렉토리 + 독립 compose + 독립 systemd unit. 다른 봇 추가는 동일 패턴 반복.

## 0. VM 가정

- Oracle Cloud Free Tier VM (예: VM.Standard.A1.Flex 1OCPU/6GB, OL9)
- SSH 사용자: `opc` (Oracle Linux 기본)
- 봇은 outbound only — Security List / Firewall ingress 변경 불요

## 1. 호스트 1회 셋업

```bash
# SSH 접속
ssh opc@<vm-public-ip>

# Podman + compose plugin (OL9 기본 podman 설치되어 있음)
sudo dnf install -y podman podman-compose git
podman --version
podman compose version           # 또는 podman-compose --version

# rootless 모드용 lingering — opc 가 로그아웃해도 컨테이너 유지
sudo loginctl enable-linger opc

# 디렉토리
mkdir -p ~/services
```

## 2. 봇 코드 배치

```bash
cd ~/services
git clone https://github.com/gogobibi/ff14-kr-discord-bot.git
cd ff14-kr-discord-bot

# .env 작성 — chmod 600 으로 다른 user 접근 차단
cp .env.example .env
chmod 600 .env
$EDITOR .env                     # DISCORD_TOKEN / DEEPSEEK_API_KEY 등 채우기

# DB 볼륨 호스트 측 디렉토리
mkdir -p data
```

## 3. 빌드 + 실행

```bash
podman compose up -d --build

# 동작 확인
podman ps
podman logs -f ff14-kr-discord-bot
```

기대 로그:
```
✅ 로그인: ff14-kr-bot#NNNN
[guild] 참여 길드 N개 동기화 완료
[scheduler] cron 시작 (KST): 17:45·20:00 스크래핑 + 09:00 알림
```

## 4. 슬래시 명령 등록 (1회 + 변경 시마다)

```bash
podman exec ff14-kr-discord-bot node src/deploy-commands.js
```

## 5. systemd unit (자동 시작 + crash 복구)

`~/.config/systemd/user/ff14-kr-discord-bot.service`:
```ini
[Unit]
Description=FF14 KR Discord bot (podman compose)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=%h/services/ff14-kr-discord-bot
ExecStart=/usr/bin/podman compose up -d
ExecStop=/usr/bin/podman compose down
ExecReload=/usr/bin/podman compose restart
TimeoutStartSec=300

[Install]
WantedBy=default.target
```

등록·기동:
```bash
systemctl --user daemon-reload
systemctl --user enable --now ff14-kr-discord-bot.service
systemctl --user status ff14-kr-discord-bot.service
```

`Type=oneshot` + `RemainAfterExit=yes` 이유: `podman compose up -d` 는 컨테이너를 detached 로 띄우고 즉시 반환 → systemd 가 service 종료로 오해. 컨테이너 자체의 재시작은 `restart: unless-stopped` (compose.yaml) 가 책임.

## 6. 로그 / 모니터링

```bash
podman logs -f ff14-kr-discord-bot                              # 봇 stdout/stderr
podman logs --since 1h ff14-kr-discord-bot | grep '\[스크래핑\]'  # cron 트리거 확인
systemctl --user status ff14-kr-discord-bot.service             # systemd 상태
```

## 7. DB 백업 (cron + 외부 스토리지)

```bash
# crontab -e
# 매일 03:00 KST 에 events.db snapshot 을 ~/backups/ 로 복사
0 3 * * * cd ~/services/ff14-kr-discord-bot && cp data/events.db ~/backups/events-$(date +\%Y\%m\%d).db && find ~/backups -name 'events-*.db' -mtime +30 -delete
```

원격 백업 (선택): `rclone` / `restic` / S3 Object Storage (Oracle 도 무료 티어 있음) 로 ~/backups 동기화.

## 8. 업데이트 (git pull → 재빌드)

```bash
cd ~/services/ff14-kr-discord-bot
git pull
podman compose up -d --build       # 이미지 재빌드 + 컨테이너 재기동
podman logs --tail 50 ff14-kr-discord-bot
```

스키마 변경이 있으면 `initDB` 의 `migrate()` 가 자동 처리 (멱등).

## 9. 다른 봇 추가 (미래)

같은 호스트에 봇 하나 더:
```bash
cd ~/services
git clone https://github.com/<owner>/<another-bot>.git
cd <another-bot>
cp .env.example .env && chmod 600 .env && $EDITOR .env
podman compose up -d --build

# systemd unit 도 봇별 — 이름만 바꿔서 동일 템플릿
cp ~/.config/systemd/user/ff14-kr-discord-bot.service \
   ~/.config/systemd/user/<another-bot>.service
$EDITOR ~/.config/systemd/user/<another-bot>.service   # WorkingDirectory·Description 수정
systemctl --user enable --now <another-bot>.service
```

봇 간 격리 (network, fs, env_file, container name) 모두 독립 — 한 봇 문제가 다른 봇에 전파 안 됨.

## 트러블슈팅

- **`podman compose` 명령 못 찾음**: `sudo dnf install -y podman-compose` 또는 `pip install podman-compose`. OL9 의 podman 4.x 부터는 `podman compose` 서브명령 지원.
- **`data/events.db` permission denied**: rootless podman 은 user namespace 매핑. `chown -R 1000:1000 data` (컨테이너의 node user uid=1000) 또는 `podman unshare chown 1000:1000 data`.
- **better-sqlite3 빌드 실패**: Dockerfile 의 build stage 가 `python3 make g++` 설치. 알파인 이미지 변경 시에도 이 셋 유지.
- **봇이 토큰 invalid 라고 함**: `.env` 의 `DISCORD_TOKEN` 양쪽 따옴표·줄바꿈 확인. compose `env_file` 은 따옴표 없이 raw 값.
