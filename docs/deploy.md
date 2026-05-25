# 배포 가이드 — Oracle Cloud (OL9 + bare Node.js + systemd)

컨테이너 없이 Node.js 를 호스트에 직접 설치하고 `systemd --user` 로 봇 프로세스를 관리. E2.1.Micro 1GB VM 에서 가장 가벼운 구성.

> 1GB VM 에 봇 2개 이상은 빠듯하다. 멀티봇이 필요해지면 A1.Flex (6GB) 로 옮기거나 컨테이너 구성을 도입 — 그 시점에 git 히스토리에서 이전 podman compose 구성을 복원하면 됨.

## 0. VM 가정

- Oracle Cloud Free Tier VM — **VM.Standard.E2.1.Micro** (x86, 1OCPU / 1GB RAM, OL9)
  - A1.Flex (6GB) 도 동일 절차로 동작 — 1-A swap 단계만 스킵
- SSH 사용자: `opc` (Oracle Linux 기본)
- 봇은 outbound only — Security List / Firewall ingress 변경 불요

## 1. 호스트 1회 셋업

```bash
ssh opc@<vm-public-ip>
```

### 1-A. (E2.1.Micro 한정) Swap 2GB 추가

1GB RAM 은 `npm ci` 도중 OOM kill 위험. **Node.js 설치 전에 실행**:

```bash
free -h                           # Swap 이 0 이면 진행
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h                           # Swap: 2.0Gi 확인
```

A1.Flex (6GB) 면 이 단계 스킵.

### 1-B. Node.js 22 LTS + git 설치

OL9 기본 repo 의 Node 는 너무 오래되어 NodeSource repo 사용:

```bash
# NodeSource Node 22 LTS repo 등록
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs git
node --version                    # v22.x
npm --version
```

### 1-C. systemd --user lingering

```bash
# opc 가 로그아웃해도 user service 가 계속 살아있도록
sudo loginctl enable-linger opc

# 작업 디렉토리
mkdir -p ~/services
```

## 2. 봇 코드 배치

```bash
cd ~/services
git clone https://github.com/gogobibi/ff14-kr-discord-bot.git
cd ff14-kr-discord-bot

# 의존성 설치 (prod only — better-sqlite3 prebuilt 바이너리 사용으로 컴파일 불요)
npm ci --omit=dev

# .env 작성
cp .env.example .env
chmod 600 .env
$EDITOR .env                      # DISCORD_TOKEN / DISCORD_CLIENT_ID / DEEPSEEK_API_KEY 채우기

# DB 디렉토리 (initDB() 가 첫 실행 시 events.db 자동 생성)
mkdir -p data
```

`npm ci` 출력에 `better-sqlite3` 가 prebuilt binary 다운로드로 끝나면 성공. 만약 `node-gyp rebuild` 가 돌면서 g++ 컴파일이 시작되면 [트러블슈팅](#트러블슈팅) 참고.

## 3. 첫 실행 (포그라운드 smoke test)

```bash
node src/index.js
```

기대 출력:
```
✅ 로그인: ff14-kr-bot#NNNN
[guild] 참여 길드 N개 동기화 완료
[scheduler] cron 시작 (KST): 17:45·20:00 스크래핑 + 09:00 알림
```

확인 후 `Ctrl-C` 로 종료. 다음 단계에서 systemd 가 백그라운드로 띄움.

## 4. 슬래시 명령 등록 (1회 + 변경 시마다)

```bash
node src/deploy-commands.js
```

봇이 참여한 길드에서 `/이벤트` / `/이벤트-알림채널` 명령이 나타나면 성공. Global 명령 propagation 은 최대 1시간.

## 5. systemd unit (자동 시작 + crash 복구)

`~/.config/systemd/user/ff14-kr-discord-bot.service`:
```ini
[Unit]
Description=FF14 KR Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/services/ff14-kr-discord-bot
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5s
# Node 의 메모리 한계 (E2.1.Micro 1GB 보호) — 필요 시 조정
Environment=NODE_OPTIONS=--max-old-space-size=384

[Install]
WantedBy=default.target
```

등록·기동:
```bash
mkdir -p ~/.config/systemd/user
$EDITOR ~/.config/systemd/user/ff14-kr-discord-bot.service   # 위 내용 붙여넣기

systemctl --user daemon-reload
systemctl --user enable --now ff14-kr-discord-bot.service
systemctl --user status ff14-kr-discord-bot.service
```

`Type=simple` + `Restart=on-failure` 로 봇이 죽으면 5초 후 재기동. Discord WebSocket 끊김은 discord.js 가 자체 reconnect 하므로 process restart 까지 갈 일은 드묾.

## 6. 로그 / 모니터링

```bash
journalctl --user -u ff14-kr-discord-bot.service -f                       # 실시간 tail
journalctl --user -u ff14-kr-discord-bot.service --since "1 hour ago"     # 최근 1시간
journalctl --user -u ff14-kr-discord-bot.service --since today | grep '\[스크래핑\]'
systemctl --user status ff14-kr-discord-bot.service                       # 상태 + 마지막 10줄
```

## 7. DB 백업 (cron + 외부 스토리지)

```bash
# crontab -e
# 매일 03:00 KST 에 events.db snapshot 을 ~/backups/ 로 복사, 30일 이상 된 백업 정리
0 3 * * * cd ~/services/ff14-kr-discord-bot && cp data/events.db ~/backups/events-$(date +\%Y\%m\%d).db && find ~/backups -name 'events-*.db' -mtime +30 -delete
```

원격 백업 (선택): `rclone` / `restic` / Oracle Object Storage 로 `~/backups` 동기화.

## 8. 업데이트 (git pull → 재시작)

```bash
cd ~/services/ff14-kr-discord-bot
git pull
npm ci --omit=dev                                       # 의존성 변경된 경우만 영향 있음
systemctl --user restart ff14-kr-discord-bot.service
journalctl --user -u ff14-kr-discord-bot.service -n 50
```

스키마 변경이 있으면 `initDB` 의 `migrate()` 가 자동 처리 (멱등).

슬래시 명령 정의가 바뀌었으면 추가로:
```bash
node src/deploy-commands.js
```

## 트러블슈팅

- **`npm ci` 중 `Killed`**: OOM kill. [1-A](#1-a-e21micro-한정-swap-2gb-추가) swap 추가 후 재시도. `free -h` 로 Swap 잡혔는지 먼저 확인.
- **`better-sqlite3` 가 prebuilt 못 받고 컴파일 시도**: NodeSource 의 Node 버전이 prebuilt 와 안 맞을 때. 빌드 도구 설치 후 재시도:
  ```bash
  sudo dnf install -y gcc-c++ make python3
  rm -rf node_modules
  npm ci --omit=dev
  ```
- **`data/events.db` permission denied**: `ls -la data/` 로 소유자 확인. systemd --user 는 `opc` 권한으로 돌므로 `chown -R opc:opc data` 로 정리.
- **봇이 토큰 invalid 라고 함**: `.env` 의 `DISCORD_TOKEN` 양쪽 따옴표·줄바꿈 확인. dotenv 는 raw 값 그대로 읽음.
- **슬래시 명령이 안 보임**: `node src/deploy-commands.js` 실행 여부 확인. Global 명령은 propagation 에 최대 1시간 — 즉시 테스트가 필요하면 `.env` 에 `DEV_GUILD_ID` 설정 후 재실행 (해당 길드는 즉시 반영).
- **`systemctl --user` 가 logout 후 죽음**: `loginctl enable-linger opc` 실행 여부 확인. `loginctl show-user opc | grep Linger` 가 `yes` 여야 함.
