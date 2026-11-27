# 교실 체육 퀴즈게임 아레나

- 화면: `index.html` (GitHub Pages)
- 데이터 서버: Google Apps Script `Code.gs` (구글시트 읽기·저장)
- 서버 주소는 `index.html` 맨 위 `CONFIG.apiUrl` 한 곳에만 적습니다. 비어 있으면 데모 모드로 열립니다.
- Code.gs를 고친 뒤에는 Apps Script에서 **배포 관리 → 수정 → 새 버전**으로 다시 배포해야 반영됩니다.
- Claude로 수정할 때 참고하는 안내서는 [`CLAUDE.md`](CLAUDE.md) 입니다.

## Code.gs 를 처음 설치할 때

1. 구글 스프레드시트 → 확장 프로그램 → Apps Script → `Code.gs` 에 이 파일 전체를 붙여넣기
   (이 방식에서는 `index.html` 을 Apps Script 에 넣을 필요가 없습니다. 화면은 GitHub Pages 가 보여줍니다.)
2. `setup` 실행 → 권한 승인 (시트·예시 데이터 생성, 이미 있는 데이터는 유지)
3. 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: **모든 사용자**) → 나온 주소를 `CONFIG.apiUrl` 에 입력
4. 시트 `설정` 탭에서 **교사비밀번호·학생비밀번호를 꼭 바꾸세요** (초기값은 공개 코드에 보입니다)
