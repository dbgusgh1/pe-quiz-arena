# 교실 체육 퀴즈게임 아레나 — 작업 안내서 (Claude용)

중학교 체육교사(Mosess)가 만든 교실용 게임 모음입니다. 사용자는 코딩 전문가가 아니므로,
**한국어로, 쉬운 말로** 답하고 결과는 "무엇이 바뀌었는지"를 짧게 알려 주세요.

## 1. 구조 (파일 2개가 전부)

| 파일 | 역할 | 어디서 실행되나 |
|---|---|---|
| `index.html` | 게임 화면·게임 24종 전부 (약 1만 줄, 780KB, 한 파일) | GitHub Pages (학생 폰/태블릿 브라우저) |
| `Code.gs` | 데이터 서버 (구글 시트 읽기·쓰기, 로그인, 순위, 레이드) | 구글 Apps Script 웹 앱 |

- 화면 ↔ 서버는 `fetch`로 통신합니다. 서버 주소는 `index.html` 맨 위 `CONFIG.apiUrl` **한 곳**에만 있고, **절대 바꾸지 마세요**(바꾸면 학생들이 접속 못 함).
- 서버 코드를 고치면 사용자가 Apps Script에서 **배포 관리 → 수정(연필) → 버전: 새 버전 → 배포**를 해야 반영됩니다. `index.html`만 고친 경우는 이 과정이 필요 없습니다. 작업이 끝나면 **어느 쪽을 했는지** 꼭 알려 주세요.
- 화면 제목 "교실 체육 퀴즈게임 아레나"는 의도된 이름입니다(원본 "체육·건강 퀴즈 배틀 아레나"로 되돌리지 마세요).

## 2. index.html 안에서 길 찾기 (파일이 크니 통째로 읽지 말고 검색하세요)

- 구역은 `* 숫자. 제목` 주석으로 나뉩니다: `grep -n "^ \*  [0-9]*\. " index.html`
- 게임 하나 = `regGame('id', { name, icon, kind, tag, desc, create(){ ... } })` 블록 하나. 위치: `grep -n "^regGame(" index.html`
- 공통 도구: `E`(엔진: start/stop/hud/btn), `Quiz.ask(n,{ctx,title})`(퀴즈), `finishGame({...})`(결과 저장), `ST()`(강화 스탯), `FX()`·`Banner()`·`T()`(효과·글자), `SFX.*`(효과음), `api(fn, ...args)`(서버 호출).
- 구글 밖에서 열면 `Mock`(데모용 가짜 서버)이 돕니다. `CONFIG.apiUrl`을 비우면 데모 모드.

| id | 게임 | 종류 | id | 게임 | 종류 |
|---|---|---|---|---|---|
| shooter | ✈️ 1945 에어피트니스 | main | volley | 🏐 비타민 배구 | main |
| td | 🏰 건강 요새 지키기 | main | hroad | 🪖 헬시 로드 | main |
| kart | 🏎️ 헬스 그랑프리 | main | flap | 🎈 맑은 숨 비행 | main |
| archer | 🏹 운동용사 서바이벌 | main | road | 🚸 안전 등굣길 | main |
| raid | 👹 팀 레이드 | team | soap | 🧼 거품 용사 | main |
| platform | 🏃 헬시 점프 어드벤처 | main | land | 🗺️ 땅따먹기 | main |
| candy | 🍭 구슬 솜사탕 | main | tetris / mole / pong / hoop / timer / plinko | 미니 6종 | mini |
| omok / chess / yut / rhythm / pk | 오목·체스·윷놀이·리듬 챌린지·승부차기 | mini | | | |

## 3. 같이 맞춰야 하는 곳 (하나만 고치면 깨지는 것들)

1. **새 게임 추가** → ① `index.html`에 `regGame` 블록 ② `index.html`의 `Mock` 안 `games` 목록 ③ `Code.gs`의 `GAMES` 표(`id: ['이름','main|mini|team', 1판 최대 TP, 하루 최대 TP]`). 세 곳이 같아야 TP 저장이 됩니다.
2. **화면에서 새 서버 함수를 부를 때** → `Code.gs`의 `apiTable_()`에 한 줄 추가. 읽기만 하는 함수면 `API_GET_OK_`와 `index.html`의 `API_READ`에도 같은 이름을 추가. (`apiTable_`에 없는 함수는 밖에서 호출되지 않도록 막혀 있음 — 보안상 유지)
3. 게임 TP 값은 서버(`saveGame`)가 한 판 상한·시간·하루 상한으로 다시 검증합니다. 화면에서 숫자만 키워도 서버가 깎습니다. 이 검증은 약하게 만들지 마세요.

## 4. 수정 후 검증 (매번)

```bash
# 1) 문법 검사 (index.html 의 <script> 를 뽑아서)
python3 - <<'EOF'
import re;h=open('index.html',encoding='utf-8').read()
open('/tmp/idx.js','w',encoding='utf-8').write('\n'.join(re.findall(r'<script>(.*?)</script>',h,flags=re.S)))
EOF
node --check /tmp/idx.js && cp Code.gs /tmp/Code.js && node --check /tmp/Code.js
# 2) 화면 로드 시험: apiUrl 을 비운 복사본을 playwright(chromium)로 열어 pageerror 가 없는지 확인
# 3) 게임을 고쳤다면: 그 게임을 몇 천 프레임 돌려서(E.start → update/draw 반복) 오류 없는지 확인
```

## 5. 주의 (위험과 대응)

- 이 저장소는 **공개(public)** 입니다. 비밀번호·구글 시트 주소·개인정보(학생 이름 등)를 코드나 커밋에 넣지 마세요. `Code.gs`의 `teacher1234`/`1234`는 **초기값**일 뿐, 실제 값은 구글 시트 `설정` 탭에서 바꿔 쓰는 것이므로 그대로 쓰지 않도록 사용자에게 안내하세요.
- 사용자가 학생이 쓰는 도중에 수정을 요청할 수 있습니다. 큰 변경은 한 번에 하나씩, 기존 게임의 동작을 바꾸지 않는 방식(새 코드 추가)을 우선하세요.
- 사용자는 다른 Claude 계정에 다른 버전을 둘 수 있습니다. 파일을 새로 받으면 먼저 이 저장소와 **차이를 비교**한 뒤, 덮어쓰기 전에 무엇이 사라지는지 알려 주세요.

## 6. 버전 기록

- **v7 (헬시 로드: 진화 10단계·퇴화·버그 수정)** — 화면(`index.html`)은 v7 + GitHub Pages 연결 방식. 서버(`Code.gs`)는 v7 + API 연결부(`doGet`/`doPost`/`apiTable_`).
