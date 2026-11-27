/**
 * ============================================================
 *  🏆 체육·건강 퀴즈 배틀 아레나  (Google Apps Script 서버)  v2 패치
 * ============================================================
 *  [설치 방법]
 *  1) 새 구글 스프레드시트 → 확장 프로그램 → Apps Script
 *  2) Code.gs 에 이 파일 전체 붙여넣기
 *  3) + 버튼 → HTML → 이름을 정확히 "index" 로 만들고 index.html 붙여넣기
 *  4) 함수 선택에서 setup 실행 → 권한 승인 (시트 7개 + 예시 데이터 생성)
 *     ※ 이미 쓰던 시트라면 setup 을 다시 실행해도 됩니다 (없는 열만 추가, 데이터 유지)
 *  5) 배포 → 새 배포 → 유형: 웹 앱
 *       - 다음 사용자로 실행: 나(교사 계정)
 *       - 액세스 권한: 모든 사용자
 *     → 나온 URL을 학생 태블릿/폰에 공유 (QR 추천)
 *  6) 코드를 수정하면: 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포
 *
 *  [v2 패치 요약 — 31명 동시 접속 대비]
 *  - 학생 표를 CacheService 에 60초 캐시 → 매 요청마다 시트 전체를 읽지 않음
 *  - 학생 개인 행 쓰기(퀴즈·게임저장·강화)는 전역 락 없이 "자기 행만" 읽고 씀
 *    (락은 팀 시트·이벤트 같은 공유 데이터에만 2~3초 이내로 사용)
 *  - 하루 TP 상한·팀 미션 참여를 캐시 대신 시트 열에 저장 (캐시 증발해도 안전)
 *  - 전체 퀴즈 이벤트를 ScriptProperties 에 보관 (캐시 증발해도 안전)
 *  - 순위는 10초 캐시
 *  - 팀 레이드 TP 상한 수정 (45초 게임이 최대 40TP 받을 수 있게)
 *  - 이벤트 만료 시간(endsAt) 적용
 *  - 로그인: 번호 + 반 공통 비밀번호(설정 시트 '학생비밀번호')
 *  - 게임 정리: 미로달리기→슛 챌린지, 묵찌빠·주사위·끝말잇기 삭제 (끝말잇기단어 시트는 지워도 됨)
 *  [v4 — 여러 반(1~11반) 누적 운영]
 *  - 로그인: 학번 5자리 (10101 = 1학년 1반 1번, 11105 = 1학년 11반 5번) + 공통 비밀번호 1234
 *  - 반마다 모둠·순위·레이드·전체퀴즈 이벤트·온라인 대전방이 따로 돌아감 (반끼리 섞이지 않음)
 *  - 설정 시트 '반목록'(예: 1-1,1-2,…,1-11)에 있는 반은 처음 로그인할 때 자동으로 학생이 등록됨
 *    (이름은 '1-1반 1번', 모둠은 번호 순 6명씩 → 학생 시트에서 이름·모둠을 고치면 됨)
 *  - 교사 화면: 반(방)을 골라 그 반만 보기 · 그 반 데이터만 초기화/삭제
 *  - 메뉴 '반별 학생 명단 만들기' : 반목록 × 반인원 만큼 빈 명단을 미리 만듦
 *
 *  [v3]
 *  - 새 게임: 땅따먹기·헬시 점프 어드벤처(메인), 승부차기 심리전·리듬 챌린지(미니)
 *  - 설정 시트 '땅따먹기이미지'(배경 사진 링크), '리듬곡'(MR 링크|BPM|오프셋) 추가
 *  - 팀 이름 공백 무시 비교, 팀 미배정 학생 교사 화면 경고, 게임기록 '비고' 열(오토클리커 의심)
 * ============================================================
 */

const SH = {
  SET: '설정', STU: '학생', TEAM: '팀', QUIZ: '퀴즈',
  LOG: '게임기록', QLOG: '퀴즈기록'
};

// 학생 시트 열 (0부터)
const C = {
  NO: 0, NAME: 1, TEAM: 2, PIN: 3, PICK: 3, TP: 4, GEM: 5,
  ATK: 6, HP: 7, SPD: 8, CRT: 9, LCK: 10,
  STAGE: 11, USED: 12, CORRECT: 13, SOLVED: 14, CYCLE: 15, LAST: 16, DAILY: 17, WRONG: 18
};
const STU_HEADER = ['번호', '이름', '팀', '모둠선택(자동)', 'TP(점수)', '강화석', '힘', '체력', '스피드', '집중', '행운',
  '최고스테이지(자동)', '사용문제(자동)', '정답수', '풀이수', '문제회차', '마지막저장', '오늘TP(자동)', '틀린문제(자동)'];
// 팀 시트 열 (0부터)
const TC = { NAME: 0, BONUS: 1, BUFF: 2, RLV: 3, RHP: 4, RMAX: 5, MDONE: 6, PLAYED: 7, CLS: 8 };
const TEAM_HEADER = ['팀명', '보너스TP', '공격버프%', '레이드레벨', '레이드HP', '레이드최대HP', '팀미션달성일', '오늘참여(자동)', '반'];
const TEAM_NAMES = ['1모둠', '2모둠', '3모둠', '4모둠', '5모둠'];
const STAT_COL = { atk: C.ATK, hp: C.HP, spd: C.SPD, crt: C.CRT, lck: C.LCK };
const STAT_MAX = 20;

const GAMES = {
  // id: [이름, 종류, 1판 최대 TP, 하루 최대 TP]
  td: ['건강 요새 지키기', 'main', 60, 300],
  kart: ['헬스 그랑프리', 'main', 50, 300],
  shooter: ['1945 에어피트니스', 'main', 60, 300],
  archer: ['운동용사 서바이벌', 'main', 60, 300],
  land: ['땅따먹기', 'main', 60, 300],
  platform: ['헬시 점프 어드벤처', 'main', 60, 300],
  candy: ['구슬 솜사탕', 'main', 60, 300],
  raid: ['팀 레이드', 'team', 40, 200],
  tetris: ['테트리스', 'mini', 10, 40],
  mole: ['두더지 잡기', 'mini', 10, 40],
  pong: ['핑퐁', 'mini', 10, 40],
  hoop: ['슛 챌린지', 'mini', 10, 40],
  yut: ['윷놀이', 'mini', 10, 40],
  omok: ['오목', 'mini', 10, 40],
  chess: ['체스', 'mini', 10, 40],
  plinko: ['공 떨어뜨리기', 'mini', 8, 40],
  volley: ['비타민 배구', 'main', 60, 300],
  soap: ['거품 용사', 'main', 60, 300],
  road: ['안전 등굣길', 'main', 60, 300],
  flap: ['맑은 숨 비행', 'main', 60, 300],
  hroad: ['헬시 로드', 'main', 60, 300],
  // 🕹️ 원클릭 게임 (버튼 하나) — 1판 최대 8TP, 하루 24TP
  ob_rope: ['쌩쌩줄넘기', 'one', 8, 24],
  ob_stomp: ['껑충껑충', 'one', 8, 24],
  ob_brick: ['깨부숴', 'one', 8, 24],
  ob_dodge: ['요리조리 피하기', 'one', 8, 24],
  ob_tail: ['줄줄이 모둠', 'one', 8, 24],
  ob_cloud: ['구름 점프', 'one', 8, 24],
  ob_ice: ['빙판 지그재그', 'one', 8, 24],
  ob_swim: ['수영왕', 'one', 8, 24],
  ob_top: ['팽이 점프', 'one', 8, 24],
  ob_ski: ['스키 슬라럼', 'one', 8, 24],
  ob_punch: ['펀치 행진', 'one', 8, 24],
  timer: ['초 맞추기', 'mini', 8, 40],
  pk: ['승부차기 심리전', 'mini', 10, 40],
  rhythm: ['리듬 챌린지', 'mini', 10, 40]
};

/* ------------------------------------------------------------
 *  웹앱 진입
 * ------------------------------------------------------------ */
function doGet(e) {
  // GitHub Pages 화면(index.html)이 부르는 API:  ?action=함수이름&args=[...]
  if (e && e.parameter && e.parameter.action) return apiHandle_(e.parameter.action, e.parameter.args, true);
  // 주소만 열었을 때: (예전 방식) 앱스 스크립트에 index.html 이 있으면 그 화면을, 없으면 안내 문구
  try {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('체육·건강 퀴즈 배틀 아레나')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return ContentService.createTextOutput('이 주소는 데이터 서버입니다. 게임 화면은 GitHub Pages 주소로 들어가세요.');
  }
}

/** 저장·비밀번호 같은 쓰기 요청은 POST (본문은 text/plain 으로 보낸 JSON: {action, args}) */
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return apiJson_({ ok: 0, error: 'BAD_REQUEST' }); }
  return apiHandle_(body.action, body.args, false);
}

/* ------------------------------------------------------------
 *  API 연결부 (index.html 의 apiFetch_ 와 짝)
 *  ★ 화면에서 새 서버 함수를 부르게 되면 → 아래 apiTable_ 에 한 줄 추가
 *    (읽기만 하는 함수면 API_GET_OK_ 에도 추가. index.html 의 API_READ 와 같아야 함)
 *  ★ 여기에 없는 함수(setup, clearAllCache 등 관리용)는 밖에서 절대 호출되지 않습니다.
 * ------------------------------------------------------------ */
const API_GET_OK_ = { getState: 1, getRanking: 1, getRaid: 1, getTeamSlots: 1, roomList: 1, roomGet: 1 };
function apiTable_() {
  return {
    login: login, getState: getState, getQuizzes: getQuizzes, submitQuiz: submitQuiz, upgradeStat: upgradeStat,
    saveGame: saveGame, raidHit: raidHit, getRaid: getRaid, getRanking: getRanking, eventSubmit: eventSubmit,
    getTeamSlots: getTeamSlots, chooseTeam: chooseTeam,
    roomList: roomList, roomCreate: roomCreate, roomJoin: roomJoin, roomGet: roomGet, roomPush: roomPush, roomSync: roomSync, roomLeave: roomLeave,
    teacherLogin: teacherLogin, tDashboard: tDashboard, tSetOpenGames: tSetOpenGames, tSetNotice: tSetNotice, tSetMode: tSetMode,
    tRefreshQuiz: tRefreshQuiz, tStartEvent: tStartEvent, tEndEvent: tEndEvent, tGiveTeamTP: tGiveTeamTP, tGiveStudent: tGiveStudent,
    tMoveTeam: tMoveTeam, tResetClass: tResetClass, tResetQuizUsage: tResetQuizUsage, tResetTeamPick: tResetTeamPick, tNewSeason: tNewSeason
  };
}
function apiJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function apiHandle_(fn, argStr, viaGet) {
  try {
    const table = apiTable_();
    if (!fn || !Object.prototype.hasOwnProperty.call(table, fn)) throw new Error('NO_FUNC');
    if (viaGet && !API_GET_OK_[fn]) throw new Error('POST_ONLY');   // 주소(GET)로는 읽기 함수만 허용
    let args = typeof argStr === 'string' ? JSON.parse(argStr || '[]') : (argStr || []);
    if (!Array.isArray(args)) args = [];
    const r = table[fn].apply(null, args);
    return apiJson_({ ok: 1, data: r === undefined ? null : r });
  } catch (err) {
    // 'AUTH' · 'BUSY' · 'TEACHER_AUTH' 같은 짧은 코드가 그대로 화면에 전달됨 (화면이 이 글자를 보고 재로그인 등을 처리)
    return apiJson_({ ok: 0, error: String((err && err.message) || err) });
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎮 게임관리')
    .addItem('① 초기 설정 / 열 보강 (시트 만들기)', 'setup')
    .addItem('반별 학생 명단 만들기 (반목록 × 반인원)', 'makeRoster')
    .addItem('퀴즈 캐시 새로고침 (문제 수정 후)', 'refreshQuizCache')
    .addItem('모든 학생 문제 사용기록 초기화', 'resetQuizUsageMenu')
    .addItem('기본 문항 400개 넣기 (없는 것만 추가)', 'appendSampleQuizzes')
    .addItem('캐시 전체 비우기 (이상할 때)', 'clearAllCache')
    .addToUi();
}

/* ------------------------------------------------------------
 *  초기 설정  (이미 있는 시트는 건드리지 않고, 빠진 열·설정만 보강)
 * ------------------------------------------------------------ */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid());

  // 설정
  let s = ss.getSheetByName(SH.SET);
  const SET_ROWS = [
    ['교사비밀번호', 'teacher1234', '교사 화면 로그인 비밀번호 (꼭 바꾸세요)'],
    ['학생비밀번호', '1234', '학생 로그인용 공통 비밀번호 (학번 5자리 + 이 비밀번호로 입장)'],
    ['반목록', '1-1,1-2,1-3,1-4,1-5,1-6,1-7,1-8,1-9,1-10,1-11', '운영하는 반 (학년-반). 여기 있는 반 학생은 처음 로그인할 때 자동 등록'],
    ['반인원', '31', "'반별 학생 명단 만들기' 인원 + 모둠 정원 기준 (31명 → 6·6·6·6·7명). 자동 등록은 1~40번까지"],
    ['학년', '', '비워두면 모든 문제 / 숫자 입력 시 퀴즈시트 학년이 같거나 비어있는 문제만'],
    ['팀점수방식', '합계', '합계 또는 평균 (팀 인원이 다르면 평균 추천)'],
    ['열린게임', Object.keys(GAMES).join(','), '교사 화면에서 켜고 끌 수 있음'],
    ['공지', '오늘도 안전하게! 퀴즈를 풀면 강해집니다 💪', '학생 로비 상단에 표시'],
    ['퀴즈제한시간', '20', '문제당 제한 시간(초)'],
    ['팀미션보너스', '30', '모둠원이 오늘 1판 이상 하면 팀에 주는 TP'],
    ['팀미션참여율', '80', '팀 미션 달성에 필요한 참여율(%) — 결석생 고려해 100 미만 추천'],
    ['레이드기본HP', '6000', '팀 레이드 보스 1레벨 체력'],
    ['강화비용', '2', '스탯 강화 비용 = 강화비용 × (현재레벨+1)'],
    ['학급이름', '우리반', '화면 상단 표시'],
    ['이벤트사용문제', '', '(자동) 전체 퀴즈 이벤트에 이미 나온 문제'],
    ['땅따먹기이미지', '', '땅따먹기 스테이지 배경 사진 주소(구글 드라이브 공유 링크 가능)를 쉼표로 구분. 비우면 기본 그림'],
    ['리듬곡', '', '리듬 챌린지에 넣을 MR: 한 줄에 "제목|구글드라이브 링크|BPM|시작오프셋(초)" (여러 곡은 줄바꿈 또는 ; 로 구분)']
  ];
  if (!s) {
    s = ss.insertSheet(SH.SET);
    s.getRange(1, 1, 1, 3).setValues([['항목', '값', '설명']]);
    s.getRange(2, 1, SET_ROWS.length, 3).setValues(SET_ROWS);
    styleHeader(s, 3); s.setColumnWidth(1, 140); s.setColumnWidth(2, 320); s.setColumnWidth(3, 420);
  } else {
    const have = s.getRange(1, 1, s.getLastRow(), 1).getValues().map(r => String(r[0]).trim());
    SET_ROWS.forEach(r => { if (have.indexOf(r[0]) < 0) s.appendRow(r); });
  }

  // 팀
  let t = ss.getSheetByName(SH.TEAM);
  if (!t) {
    t = ss.insertSheet(SH.TEAM);
    t.getRange(1, 1, 1, TEAM_HEADER.length).setValues([TEAM_HEADER]);
    styleHeader(t, TEAM_HEADER.length);
  } else ensureHeader_(t, TEAM_HEADER);

  // 학생: 헤더만 만들고, 반별 명단은 makeRoster 로 (반목록 × 반인원)
  let st = ss.getSheetByName(SH.STU);
  let freshStu = false;
  if (!st) {
    st = ss.insertSheet(SH.STU);
    st.getRange(1, 1, 1, STU_HEADER.length).setValues([STU_HEADER]);
    styleHeader(st, STU_HEADER.length);
    st.setFrozenRows(1);
    st.getRange('A:A').setNumberFormat('0');
    freshStu = true;
  } else {
    ensureHeader_(st, STU_HEADER);
    // 예전 '(미사용)' 열 → 모둠 선택 기록 열로 사용 (예전 값은 지움)
    const h4 = String(st.getRange(1, C.PICK + 1).getValue()).trim();
    if (h4 !== STU_HEADER[C.PICK]) {
      st.getRange(1, C.PICK + 1).setValue(STU_HEADER[C.PICK]);
      if (st.getLastRow() > 1) st.getRange(2, C.PICK + 1, st.getLastRow() - 1, 1).setValue('');
    }
  }

  // 퀴즈
  let q = ss.getSheetByName(SH.QUIZ);
  if (!q) {
    q = ss.insertSheet(SH.QUIZ);
    const rows = [['ID', '학년(비우면 전체)', '분야', '난이도(1~3)', '문제', '보기1', '보기2', '보기3', '보기4', '정답번호(1~4)', '해설']];
    sampleQuizzes().concat(extraQuizzes()).forEach((r, i) => rows.push(['Q' + (i + 1)].concat(r)));
    q.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    styleHeader(q, rows[0].length);
    q.setFrozenRows(1); q.setColumnWidth(5, 380);
  } else { try { appendSampleQuizzes(true); } catch (e) { } }   // 기존 시트: 새 문항(중1 체육·건강 300개) 중 없는 것만 추가

  try { if (String(getSettings()['반인원']).trim() === '30' && !props_().getProperty('per31')) { setSetting('반인원', '31'); props_().setProperty('per31', '1'); } } catch (e) { }
  // 삭제된 게임 id 정리 (예전 원클릭 17종 중 뺀 5개 등) — 열린게임 목록에서 제거
  try { const cur = String(getSettings()['열린게임'] || '').split(',').map(x => x.trim()).filter(Boolean); const kept = cur.filter(id => GAMES[id]); if (kept.length !== cur.length) setSetting('열린게임', kept.join(',')); } catch (e) { }
  // 새로 추가된 게임이 '열린게임' 목록에 없으면 열어 둠 (기존 시트 업데이트용)
  try {
    const cur = String(getSettings()['열린게임'] || '').split(',').map(x => x.trim()).filter(String);
    const known = cur.filter(k => GAMES[k]);
    Object.keys(GAMES).forEach(k => { if (known.indexOf(k) < 0 && cur.indexOf(k) < 0) known.push(k); });
    setSetting('열린게임', known.join(','));
  } catch (e) { }

  let lg = ss.getSheetByName(SH.LOG);
  if (!lg) {
    lg = ss.insertSheet(SH.LOG);
    lg.getRange(1, 1, 1, 11).setValues([['시간', '번호', '이름', '팀', '게임', '점수', '스테이지', '클리어', 'TP', '플레이(초)', '비고(⚠️의심)']]);
    styleHeader(lg, 11);
  } else if (lg.getLastColumn() < 11) { lg.getRange(1, 11).setValue('비고(⚠️의심)'); styleHeader(lg, 11); }
  let ql = ss.getSheetByName(SH.QLOG);
  if (!ql) {
    ql = ss.insertSheet(SH.QLOG);
    ql.getRange(1, 1, 1, 9).setValues([['시간', '번호', '이름', '팀', '문제ID', '분야', '정답여부', '걸린시간(초)', '상황']]);
    styleHeader(ql, 9);
  }
  const def = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  clearAllCache();
  // 반마다 모둠 5개 (없는 것만)
  try { fixTeamSheet_(); } catch (e) { }
  classList_().forEach(c => ensureClassTeams_(c));
  if (freshStu) makeRoster(true);
  refreshQuizCache();
  try { SpreadsheetApp.getUi().alert('설정 완료! 학생은 학번 5자리(예: 10101 = 1학년 1반 1번) + 비밀번호 1234 로 들어옵니다. 학생 시트에서 이름·모둠을 고치고, 교사비밀번호를 바꾼 뒤 웹 앱으로 배포하세요.'); } catch (e) { }
}

/* ---------- 반(방) ---------- */
/** 학번 → 반 ID: 10101 → '1-1', 11105 → '1-11'. 5자리 학번이 아니면 '' */
function clsOf_(no) {
  const s = String(no == null ? '' : no).trim();
  if (!/^\d{5}$/.test(s)) return '';
  return Number(s.slice(0, 1)) + '-' + Number(s.slice(1, 3));
}
function clsLabel_(c) { if (!c) return '기본반'; const p = String(c).split('-'); return p[0] + '학년 ' + p[1] + '반'; }
function clsSort_(a, b) { const pa = String(a).split('-').map(Number), pb = String(b).split('-').map(Number); return (pa[0] - pb[0]) || (pa[1] - pb[1]); }
/** 운영 중인 반 목록: 설정 '반목록' + 학생 시트에 실제 있는 반 */
function classList_() {
  const set = {};
  String(getSettings()['반목록'] || '').split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d+-\d+$/.test(x)).forEach(c => set[c] = 1);
  try { readStudentsCached().rows.forEach(r => { const c = clsOf_(r[C.NO]); if (c) set[c] = 1; }); } catch (e) { }
  return Object.keys(set).sort(clsSort_);
}
/** 반마다 모둠 5개가 팀 시트에 있도록 보강 */
function ensureClassTeams_(cls) {
  const teams = readTeams();
  const base = num(getSettings()['레이드기본HP'], 6000);
  const add = [];
  TEAM_NAMES.forEach(n => { if (teamIndex(teams, n, cls) < 0) add.push([n, 0, 0, 1, base, base, '', '', cls]); });
  if (add.length) { teamClsText_(teams.sheet); teams.sheet.getRange(teams.sheet.getLastRow() + 1, 1, add.length, TEAM_HEADER.length).setValues(add); bumpRank_(); }
}
function defaultTeam_(n) { return Math.min(5, Math.ceil(n / 6)) + '모둠'; }
function newStudentRow_(no) {
  const cls = clsOf_(no), n = Number(String(no).slice(3));
  return [Number(no), cls + '반 ' + n + '번', defaultTeam_(n), '', 0, 3, 0, 0, 0, 0, 0, '{}', '', 0, 0, 0, '', '', ''];
}
/** 메뉴: 반목록 × 반인원 만큼 명단을 미리 만듦 (이미 있는 학번은 건너뜀) */
function makeRoster(silent) {
  const s = getSettings();
  const per = clamp(num(s['반인원'], 30), 1, 40);
  const list = String(s['반목록'] || '').split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d+-\d+$/.test(x));
  const d = readStudents();
  const have = {}; d.rows.forEach(r => have[String(r[C.NO])] = 1);
  const add = [];
  list.forEach(c => {
    const p = c.split('-'), pre = String(p[0]) + ('0' + p[1]).slice(-2);
    for (let n = 1; n <= per; n++) { const no = pre + ('0' + n).slice(-2); if (!have[no]) add.push(newStudentRow_(no)); }
  });
  if (add.length) d.sheet.getRange(d.sheet.getLastRow() + 1, 1, add.length, STU_HEADER.length).setValues(add);
  stuDirty_();
  list.forEach(c => ensureClassTeams_(c));
  if (silent !== true) { try { SpreadsheetApp.getUi().alert(add.length + '명을 추가했어요. (' + list.length + '개 반 × ' + per + '명)'); } catch (e) { } }
  return add.length;
}
/** 기존 시트에 빠진 머리글 열을 오른쪽에 추가 */
function ensureHeader_(sheet, header) {
  const cur = sheet.getLastColumn();
  if (cur < header.length) {
    sheet.getRange(1, cur + 1, 1, header.length - cur).setValues([header.slice(cur)]);
    styleHeader(sheet, header.length);
  }
}
function styleHeader(sheet, n) {
  sheet.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
}
function classPw_() { return String(getSettings()['학생비밀번호'] || '1234').trim(); }
function clearAllCache() {
  try { cache().removeAll(['stu', 'settings', 'qb_n', 'ranking', 'event']); } catch (e) { }
}

/* ------------------------------------------------------------
 *  공통 유틸
 * ------------------------------------------------------------ */
function ss_() { return SpreadsheetApp.getActive(); }
function today_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd'); }
function now_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'); }
function num(v, d) { const n = Number(v); return isNaN(n) ? (d || 0) : n; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function cache() { return CacheService.getScriptCache(); }
function props_() { return PropertiesService.getScriptProperties(); }
function jparse(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
/** 공유 데이터(팀 시트·이벤트·방)에만 사용. 5초 안에 못 잡으면 BUSY */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('BUSY');
  try { return fn(); } finally { lock.releaseLock(); }
}

function getSettings() {
  const c = cache().get('settings');
  if (c) return JSON.parse(c);
  const v = ss_().getSheetByName(SH.SET).getDataRange().getValues();
  const o = {};
  v.slice(1).forEach(r => { if (r[0]) o[String(r[0]).trim()] = r[1]; });
  cache().put('settings', JSON.stringify(o), 120);
  return o;
}
function setSetting(key, value) {
  const s = ss_().getSheetByName(SH.SET);
  const v = s.getRange(1, 1, s.getLastRow(), 1).getValues();
  let row = -1;
  for (let i = 0; i < v.length; i++) if (String(v[i][0]).trim() === key) { row = i + 1; break; }
  if (row < 0) { row = s.getLastRow() + 1; s.getRange(row, 1).setValue(key); }
  s.getRange(row, 2).setValue(value);
  cache().remove('settings');
}

/* ---------- 학생 표: 시트 직접 읽기 vs 60초 캐시 ---------- */
function stuSheet_() { return ss_().getSheetByName(SH.STU); }
/** 시트에서 직접 전체 읽기 (쓰기 전·교사 화면용) */
function readStudents() {
  const s = stuSheet_();
  const n = s.getLastRow() - 1;
  const rows = n > 0 ? s.getRange(2, 1, n, STU_HEADER.length).getValues() : [];
  // 캐시(최대 100KB)에는 '사용문제' 칸을 빼고 넣음 → 여러 반(300명+)이어도 캐시에 들어감
  try { cache().put('stu', JSON.stringify(rows.map(r => { const c = r.slice(); c[C.USED] = ''; c[C.WRONG] = ''; return c; })), 60); } catch (e) { }
  return { sheet: s, rows: rows };
}
/** 캐시된 전체 읽기 (인증·조회용) — 쓰기 후엔 stuDirty_() 로 비워짐 */
function readStudentsCached() {
  const c = cache().get('stu');
  if (c) return { sheet: null, rows: JSON.parse(c) };
  return readStudents();
}
function stuDirty_() { cache().remove('stu'); bumpRank_(); }
/** 순위 캐시는 반마다 따로 → 버전 번호를 올려 한꺼번에 무효화 */
function bumpRank_() { cache().put('rv', String(Date.now()), 21600); }
function rankKey_(cls) { return 'rk_' + cls + '_' + (cache().get('rv') || '0'); }
/** 한 학생 행만 시트에서 새로 읽기 */
function readRow_(sheet, idx) { return sheet.getRange(idx + 2, 1, 1, STU_HEADER.length).getValues()[0]; }
/**
 * 학생 행 저장. '사용문제'·'문제회차' 칸은 getQuizzes 만 쓰도록 건너뜀.
 * (예전에는 퀴즈 제출·게임 저장이 행 전체를 덮어써서, 동시에 받아 간 문제 기록이 지워짐
 *  → 이미 푼 문제가 계속 다시 나오던 원인)
 */
function writeStudentRow(sheet, idx, row) {
  const r = idx + 2;
  sheet.getRange(r, 1, 1, C.USED).setValues([row.slice(0, C.USED)]);                              // 번호 ~ 최고스테이지
  sheet.getRange(r, C.CORRECT + 1, 1, 2).setValues([row.slice(C.CORRECT, C.SOLVED + 1)]);          // 정답수·풀이수
  sheet.getRange(r, C.LAST + 1, 1, STU_HEADER.length - C.LAST).setValues([row.slice(C.LAST, STU_HEADER.length)]);   // 마지막저장 ~
  stuDirty_();
}

function readTeams() {
  const s = ss_().getSheetByName(SH.TEAM);
  const n = s.getLastRow() - 1;
  const rows = n > 0 ? s.getRange(2, 1, n, TEAM_HEADER.length).getValues() : [];
  // 빈 행이 중간에 있어도 시트 행 번호를 잃지 않도록 sheetRow 보관
  const out = [];
  rows.forEach((r, i) => { if (r[TC.NAME] !== '') { r[TC.CLS] = normCls_(r[TC.CLS]); r.sheetRow = i + 2; out.push(r); } });
  return { sheet: s, rows: out };
}
/** 팀 이름 비교용: 공백 제거 + 소문자 ("1모둠 " = "1 모둠" = "1모둠") */
function tkey_(x) { return String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase(); }
/** 반 + 모둠 이름으로 팀 찾기 (반 칸이 빈 예전 팀은 '기본반') */
/**
 * 팀 시트 '반' 칸 읽기. 구글 시트는 '1-1' 을 날짜(1월 1일)로 바꿔 버리므로
 * 날짜로 바뀐 값은 다시 '월-일' → '1-1' 로 되돌려 읽음
 */
function normCls_(v) {
  if (v instanceof Date) return (v.getMonth() + 1) + '-' + v.getDate();
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);   // 혹시 '2026-01-01' 같은 글자로 들어온 경우
  if (m) return Number(m[2]) + '-' + Number(m[3]);
  return s;
}
function teamCls_(r) { return normCls_(r[TC.CLS]); }
/** '반' 열을 글자 형식으로 고정 (날짜로 바뀌지 않게) */
function teamClsText_(sheet) { sheet.getRange(1, TC.CLS + 1, sheet.getMaxRows(), 1).setNumberFormat('@'); }
/**
 * 팀 시트 정리 (한 번만 자동 실행 + setup 때마다):
 *  ① 날짜로 바뀐 '반' 값을 '1-1' 글자로 되돌림
 *  ② 그 때문에 로그인할 때마다 중복으로 생긴 모둠 줄을 하나로 합침 (보너스·레이드 진행이 큰 쪽을 남김)
 */
function fixTeamSheet_() {
  const s = ss_().getSheetByName(SH.TEAM);
  if (!s || s.getLastRow() < 2) return 0;
  teamClsText_(s);
  const n = s.getLastRow() - 1;
  const rows = s.getRange(2, 1, n, TEAM_HEADER.length).getValues();
  const keep = {}, out = [];
  rows.forEach(r => {
    if (String(r[TC.NAME]).trim() === '') return;
    r[TC.CLS] = normCls_(r[TC.CLS]);
    const k = r[TC.CLS] + '|' + tkey_(r[TC.NAME]);
    const score = x => num(x[TC.RLV], 1) * 1e6 + num(x[TC.BONUS]) * 10 + (1e6 - num(x[TC.RHP]) / 1000);
    if (keep[k] == null) { keep[k] = out.length; out.push(r); }
    else if (score(r) > score(out[keep[k]])) out[keep[k]] = r;
  });
  s.getRange(2, 1, n, TEAM_HEADER.length).clearContent();
  if (out.length) s.getRange(2, 1, out.length, TEAM_HEADER.length).setValues(out);
  if (n > out.length) s.deleteRows(2 + out.length, n - out.length);
  props_().setProperty('teamfix_v1', '1');
  bumpRank_();
  return n - out.length;
}
function teamIndex(teams, name, cls) {
  cls = cls || '';
  for (let i = 0; i < teams.rows.length; i++) if (tkey_(teams.rows[i][TC.NAME]) === tkey_(name) && teamCls_(teams.rows[i]) === cls) return i;
  return -1;
}
function writeTeamRow_(teams, i) {
  const r = teams.rows[i];
  teams.sheet.getRange(r.sheetRow, 1, 1, TEAM_HEADER.length).setValues([r.slice(0, TEAM_HEADER.length)]);
  bumpRank_();
}

/** 토큰 서명: 번호 + 반 공통 비밀번호 (비밀번호를 바꾸면 모두 다시 로그인) */
function sign_(no) {
  const secret = props_().getProperty('SECRET') || 'x';
  const raw = Utilities.computeHmacSha256Signature(no + ':' + classPw_(), secret);
  return Utilities.base64EncodeWebSafe(raw).slice(0, 16);
}
/** 토큰 확인 → {idx,row,data}. data 를 안 주면 캐시된 표 사용 */
function auth_(token, data) {
  if (!token) throw new Error('AUTH');
  const parts = String(token).split(':');
  const no = parts[0];
  const d = data || readStudentsCached();
  for (let i = 0; i < d.rows.length; i++) {
    const r = d.rows[i];
    if (String(r[C.NO]) === no) {
      if (sign_(no) !== parts[1]) throw new Error('AUTH');
      return { idx: i, row: r, data: d };
    }
  }
  throw new Error('AUTH');
}
/**
 * 쓰기용: 캐시로 위치를 찾고, 그 학생 행만 시트에서 새로 읽음.
 * (행이 밀렸으면 전체를 다시 읽어 복구) — 전역 락 없이 자기 행만 갱신
 */
function authFresh_(token) {
  const a = auth_(token);
  const sheet = stuSheet_();
  let row = readRow_(sheet, a.idx);
  if (String(row[C.NO]) !== String(a.row[C.NO])) {
    const d = readStudents();
    const b = auth_(token, d);
    return { idx: b.idx, row: b.row, sheet: d.sheet };
  }
  return { idx: a.idx, row: row, sheet: sheet };
}

function profile_(r) {
  const cls = clsOf_(r[C.NO]);
  return {
    no: r[C.NO], name: r[C.NAME], team: r[C.TEAM], cls: cls, clsName: clsLabel_(cls), tp: num(r[C.TP]), gem: num(r[C.GEM]),
    stats: { atk: num(r[C.ATK]), hp: num(r[C.HP]), spd: num(r[C.SPD]), crt: num(r[C.CRT]), lck: num(r[C.LCK]) },
    stage: jparse(r[C.STAGE], {}), correct: num(r[C.CORRECT]), solved: num(r[C.SOLVED]),
    teamPicked: isPicked_(r)
  };
}

/* ---------- 모둠 선택 ----------
 *  학생은 처음 한 번만 모둠을 고름 → '모둠선택(자동)' 열에 '선택됨' 기록, 교사가 초기화하기 전까지 고정
 *  정원: 반인원(기본 31)을 5모둠에 고르게 → 31명이면 6·6·6·6·7. 정원이 찬 모둠은 고를 수 없음
 */
const PICKED = '선택됨';
function isPicked_(r) { return String(r[C.PICK] == null ? '' : r[C.PICK]).trim() === PICKED; }
function teamCaps_(clsRows) {
  const per = clamp(Math.max(num(getSettings()['반인원'], 31), clsRows.length), 5, 40);
  const base = Math.floor(per / TEAM_NAMES.length), rem = per % TEAM_NAMES.length;
  return TEAM_NAMES.map((n, i) => base + (i >= TEAM_NAMES.length - rem ? 1 : 0));
}
function teamSlots_(cls, rows) {
  const cr = rows.filter(r => clsOf_(r[C.NO]) === cls);
  const caps = teamCaps_(cr);
  return TEAM_NAMES.map((n, i) => {
    const mem = cr.filter(r => isPicked_(r) && tkey_(r[C.TEAM]) === tkey_(n));
    return { name: n, cap: caps[i], count: mem.length, members: mem.map(r => String(r[C.NAME])) };
  });
}
function getTeamSlots(token) {
  const me = auth_(token);
  const cls = clsOf_(me.row[C.NO]);
  return { ok: true, picked: isPicked_(me.row), team: me.row[C.TEAM], slots: teamSlots_(cls, readStudentsCached().rows) };
}
function chooseTeam(token, team) {
  team = String(team || '');
  if (TEAM_NAMES.indexOf(team) < 0) return { ok: false, msg: '없는 모둠이에요' };
  return withLock(function () {
    const d = readStudents();
    const a = auth_(token, d);
    const cls = clsOf_(a.row[C.NO]);
    if (isPicked_(a.row)) return { ok: false, msg: '이미 ' + a.row[C.TEAM] + '을(를) 골랐어요. 바꾸려면 선생님께 말해 주세요', me: profile_(a.row), slots: teamSlots_(cls, d.rows) };
    const slots = teamSlots_(cls, d.rows);
    const sl = slots.filter(x => x.name === team)[0];
    if (sl.count >= sl.cap) return { ok: false, full: true, msg: team + '은(는) 자리가 다 찼어요. 다른 모둠을 골라 주세요', slots: slots };
    a.row[C.TEAM] = team; a.row[C.PICK] = PICKED;
    d.sheet.getRange(a.idx + 2, C.TEAM + 1, 1, 2).setValues([[team, PICKED]]);
    stuDirty_();
    if (cls) ensureClassTeams_(cls);
    return { ok: true, me: profile_(a.row), slots: teamSlots_(cls, d.rows) };
  });
}

/* ------------------------------------------------------------
 *  학생 API
 * ------------------------------------------------------------ */
/** 로그인: 학번 5자리(10101 = 1학년 1반 1번) + 공통 비밀번호. 반목록에 있는 반이면 처음 들어올 때 자동 등록 */
function login(no, pw) {
  if (String(pw || '').trim() !== classPw_()) return { ok: false, msg: '비밀번호가 틀렸어요' };
  no = String(no == null ? '' : no).trim();
  const find = d => { for (let i = 0; i < d.rows.length; i++) if (String(d.rows[i][C.NO]) === no) return d.rows[i]; return null; };
  const done = r => ({ ok: true, token: r[C.NO] + ':' + sign_(String(r[C.NO])), me: profile_(r), boot: bootInfo_(clsOf_(r[C.NO])) });
  let r = find(readStudentsCached());
  if (r) return done(r);
  const cls = clsOf_(no), n = Number(no.slice(3));
  if (!cls || n < 1 || n > 40) return { ok: false, msg: '학번 5자리로 입력하세요 (예: 1학년 1반 1번 → 10101)' };
  if (classList_().indexOf(cls) < 0) return { ok: false, msg: clsLabel_(cls) + '은(는) 등록된 반이 아니에요. 선생님께 말해 주세요' };
  return withLock(function () {
    const d = readStudents();
    r = find(d);
    if (!r) {
      r = newStudentRow_(no);
      d.sheet.getRange(d.sheet.getLastRow() + 1, 1, 1, STU_HEADER.length).setValues([r]);
      stuDirty_();
      ensureClassTeams_(cls);
    }
    return done(r);
  });
}

function bootInfo_(cls) {
  const s = getSettings();
  const games = {};
  Object.keys(GAMES).forEach(k => games[k] = { name: GAMES[k][0], kind: GAMES[k][1], cap: GAMES[k][2], daily: GAMES[k][3] });
  return {
    className: cls !== undefined ? clsLabel_(cls) : (s['학급이름'] || '우리반'),
    quizTime: num(s['퀴즈제한시간'], 20),
    upgradeCost: num(s['강화비용'], 2),
    statMax: STAT_MAX,
    games: games,
    landImages: String(s['땅따먹기이미지'] || '').split(/[,\n]/).map(x => x.trim()).filter(String),
    rhythmSongs: String(s['리듬곡'] || '').split(/[;\n]/).map(x => x.trim()).filter(String)
  };
}

/** 로비 주기 확인 (클라이언트 35~45초마다) — 읽기만, 락 없음 */
function getState(token) {
  const me = auth_(token);
  cache().put('seen_' + me.row[C.NO], String(Date.now()), 21600);
  const s = getSettings();
  const cls = clsOf_(me.row[C.NO]);
  const teams = readTeams();
  const ti = teamIndex(teams, me.row[C.TEAM], cls);
  const tr = ti >= 0 ? teams.rows[ti] : null;
  const ev = getEvent_(cls);
  let evOut = null;
  if (ev && ev.active && Date.now() < num(ev.endsAt) + 60000) {
    const subs = eventSubs_(ev.id);
    evOut = { id: ev.id, questions: ev.questions, endsAt: ev.endsAt, secPerQ: ev.secPerQ, done: !!subs[String(me.row[C.NO])] };
  }
  return {
    me: profile_(me.row),
    notice: s['공지'] || '',
    openGames: String(s['열린게임'] || '').split(',').map(x => x.trim()).filter(String),
    team: tr ? { name: tr[TC.NAME], buff: num(tr[TC.BUFF]), raidLv: num(tr[TC.RLV], 1), raidHp: num(tr[TC.RHP]), raidMax: num(tr[TC.RMAX], 1) } : null,
    event: evOut,
    lastEvent: ev && !ev.active ? ev.result || null : null,
    boot: bootInfo_(cls)
  };
}

/**
 * 퀴즈 꺼내기 : 학생별 중복 없음 — 자기 행만 갱신, 락 없음
 *  diff(1~3) 를 주면 그 난이도를 먼저, 없으면 가까운 난이도 순으로 고름 (스테이지에 맞춘 난이도)
 *  문제은행을 다 쓰면: 가장 최근에 본 문제들(은행의 30%, 최대 80개)은 빼고 다시 시작,
 *  틀렸던 문제를 먼저 냄 → 방금 본 문제가 바로 다시 나오지 않고, 은행이 "바닥"나지 않음
 */
function getQuizzes(token, n, diff) {
  n = clamp(num(n, 5), 1, 20);
  diff = clamp(Math.round(num(diff, 0)), 0, 3);
  const me = authFresh_(token);
  const bank = getQuizBank_();
  if (!bank.length) return { ok: false, msg: '퀴즈 시트에 문제가 없어요' };
  let usedList = String(me.row[C.USED] || '').split(',').filter(String);
  const wrong = String(me.row[C.WRONG] || '').split(',').filter(String);
  let reset = false;
  const out = [], taken = {};
  const pickFrom = list => {
    // 난이도 가까운 순 → 같은 거리 안에서는 (회차가 바뀐 뒤엔 틀린 문제 먼저) 무작위
    const wr = {}; wrong.forEach(id => wr[id] = 1);
    shuffle(list);
    list.sort((a, b) => (diff ? Math.abs(a.diff - diff) - Math.abs(b.diff - diff) : 0) || (reset ? (wr[b.id] || 0) - (wr[a.id] || 0) : 0));
    return list;
  };
  let usedSet = {}; usedList.forEach(id => usedSet[id] = 1);
  let avail = pickFrom(bank.filter(q => !usedSet[q.id]));
  // 원하는 난이도의 새 문제가 다 떨어졌고, 그 난이도 문제가 은행에 충분하면 → 회차를 넘김
  const sameLeft = diff ? avail.filter(q => q.diff === diff).length : avail.length;
  if (avail.length < n || (diff && sameLeft === 0 && bank.filter(q => q.diff === diff).length >= 10)) {
    reset = true;
    me.row[C.CYCLE] = num(me.row[C.CYCLE]) + 1;
    const keep = Math.min(80, Math.floor(bank.length * 0.3));
    usedList = usedList.slice(-keep);
    usedSet = {}; usedList.forEach(id => usedSet[id] = 1);
    avail = pickFrom(bank.filter(q => !usedSet[q.id]));
  }
  for (let i = 0; i < avail.length && out.length < n; i++) { const q = avail[i]; if (taken[q.id]) continue; taken[q.id] = 1; out.push(q); usedList.push(q.id); }
  // 그래도 모자라면(문제가 아주 적을 때) 아무거나
  for (let i = 0; out.length < n && i < bank.length * 2; i++) { const q = bank[Math.floor(Math.random() * bank.length)]; if (!taken[q.id]) { taken[q.id] = 1; out.push(q); } }
  me.row[C.USED] = usedList.join(',');
  // USED·CYCLE 두 칸만 쓰기 (다른 칸은 건드리지 않음)
  me.sheet.getRange(me.idx + 2, C.USED + 1, 1, 1).setValue(me.row[C.USED]);
  me.sheet.getRange(me.idx + 2, C.CYCLE + 1, 1, 1).setValue(me.row[C.CYCLE]);
  return { ok: true, reset: reset, quizzes: out.map(packQuiz_) };
}

/** 문제를 클라이언트로 보낼 형태로: 보기를 섞고, 정답은 간단히 숨김 */
function packQuiz_(q) {
  const ch = q.choices.map((c, i) => ({ t: c, ok: i === q.answer }));
  shuffle(ch);
  const ans = ch.findIndex(c => c.ok);
  const r = Math.floor(Math.random() * 90) + 7;
  return { id: q.id, cat: q.cat, diff: q.diff, text: q.text, choices: ch.map(c => c.t), r: r, a: (ans + r) % ch.length, exp: q.exp };
}

/** 문제은행 캐시: 400문항이 넘으면 캐시 한 칸(100KB)에 안 들어가서 여러 칸으로 나눠 저장 */
function getQuizBank_() {
  try {
    const n = num(cache().get('qb_n'), 0);
    if (n > 0) {
      const keys = []; for (let i = 0; i < n; i++) keys.push('qb_' + i);
      const parts = cache().getAll(keys);
      if (Object.keys(parts).length === n) return JSON.parse(keys.map(k => parts[k]).join(''));
    }
  } catch (e) { }
  return refreshQuizCache();
}
function putQuizBank_(bank) {
  try {
    const s = JSON.stringify(bank), size = 30000, obj = {};
    let n = 0; for (let i = 0; i < s.length; i += size) obj['qb_' + (n++)] = s.slice(i, i + size);
    cache().putAll(obj, 600); cache().put('qb_n', String(n), 600);
  } catch (e) { }
}
function refreshQuizCache() {
  const s = ss_().getSheetByName(SH.QUIZ);
  const grade = String(getSettings()['학년'] || '').trim();
  const n = s.getLastRow() - 1;
  const v = n > 0 ? s.getRange(2, 1, n, 11).getValues() : [];
  const bank = [];
  v.forEach((r, i) => {
    const text = String(r[4]).trim();
    if (!text) return;
    const g = String(r[1]).trim();
    if (grade && g && g !== grade) return;
    const choices = [r[5], r[6], r[7], r[8]].map(x => String(x).trim()).filter(String);
    if (choices.length < 2) return;
    let ans = num(r[9], 1) - 1;
    if (ans < 0 || ans >= choices.length) ans = 0;
    bank.push({
      id: String(r[0] || ('R' + (i + 2))).trim(), cat: String(r[2] || '체육').trim(),
      diff: clamp(num(r[3], 1), 1, 3), text: text, choices: choices, answer: ans, exp: String(r[10] || '')
    });
  });
  putQuizBank_(bank);
  cache().remove('settings');
  return bank;
}

/**
 * 퀴즈 결과 제출 (여러 개 한 번에)
 * results: [{id, choice(선택한 보기 글자), ms, ctx}]
 * → 서버가 정답을 다시 확인하고 강화석/TP 지급. 자기 행만 갱신, 락 없음
 */
function submitQuiz(token, results) {
  results = (results || []).slice(0, 30);
  if (!results.length) return { ok: true, gem: 0, tp: 0, correct: 0 };
  const bankMap = {};
  getQuizBank_().forEach(q => bankMap[q.id] = q);
  const me = authFresh_(token);
  let gem = 0, tp = 0, correct = 0;
  const logs = [];
  const graded = results.map(x => {
    const q = bankMap[x.id];
    const ok = !!q && String(x.choice) === q.choices[q.answer];
    if (ok) {
      correct++;
      gem += q.diff + (num(x.ms) > 0 && num(x.ms) < 5000 ? 1 : 0);
      tp += 1;
    }
    logs.push([now_(), me.row[C.NO], me.row[C.NAME], me.row[C.TEAM], x.id, q ? q.cat : '?', ok ? 'O' : 'X',
      Math.round(num(x.ms) / 100) / 10, String(x.ctx || '')]);
    return { id: x.id, ok: ok };
  });
  me.row[C.GEM] = num(me.row[C.GEM]) + gem;
  me.row[C.TP] = num(me.row[C.TP]) + tp;
  me.row[C.CORRECT] = num(me.row[C.CORRECT]) + correct;
  me.row[C.SOLVED] = num(me.row[C.SOLVED]) + results.length;
  // 틀린 문제 목록 (최근 60개): 틀리면 추가, 맞히면 빼기 → 다음 회차에 먼저 다시 나옴
  let wl = String(me.row[C.WRONG] || '').split(',').filter(String);
  graded.forEach(x => { wl = wl.filter(id => id !== x.id); if (!x.ok) wl.push(x.id); });
  me.row[C.WRONG] = wl.slice(-60).join(',');
  writeStudentRow(me.sheet, me.idx, me.row);
  appendLogs_(SH.QLOG, logs);
  return { ok: true, gem: gem, tp: tp, correct: correct, graded: graded, me: profile_(me.row) };
}
/** 로그 추가: appendRow 는 행 번호를 서버가 잡아주므로 동시 호출에도 덮어쓰기 없음 */
function appendLogs_(name, rows) {
  try { const s = ss_().getSheetByName(name); rows.forEach(r => s.appendRow(r)); } catch (e) { }
}

/** 강화소: 강화석으로 스탯 올리기 */
function upgradeStat(token, stat) {
  const col = STAT_COL[stat];
  if (col === undefined) return { ok: false, msg: '잘못된 스탯' };
  const me = authFresh_(token);
  const lv = num(me.row[col]);
  if (lv >= STAT_MAX) return { ok: false, msg: '최대 레벨이에요!' };
  const cost = num(getSettings()['강화비용'], 2) * (lv + 1);
  if (num(me.row[C.GEM]) < cost) return { ok: false, msg: '강화석이 ' + (cost - num(me.row[C.GEM])) + '개 부족해요. 퀴즈를 풀어보세요!' };
  me.row[C.GEM] = num(me.row[C.GEM]) - cost;
  me.row[col] = lv + 1;
  writeStudentRow(me.sheet, me.idx, me.row);
  return { ok: true, me: profile_(me.row) };
}

/**
 * 게임 결과 저장   r: {game, score, stage, cleared, tp, sec}
 * 하루 상한은 '오늘TP' 열(JSON)에 저장 → 캐시가 사라져도 안전
 */
function saveGame(token, r) {
  const g = GAMES[r.game];
  if (!g) return { ok: false, msg: '알 수 없는 게임' };
  const me = authFresh_(token);
  const no = me.row[C.NO];
  const sec = clamp(num(r.sec), 0, 3600);
  // TP 검증: 1판 상한, 플레이 시간 기반 상한(팀전은 초당 1, 나머지는 4초당 1), 하루 상한
  let tp = clamp(Math.round(num(r.tp)), 0, g[2]);
  const perSec = g[1] === 'team' ? 1 : 0.25;
  tp = Math.min(tp, Math.floor(sec * perSec) + 3);
  let daily = jparse(me.row[C.DAILY], {});
  if (daily.d !== today_()) daily = { d: today_() };
  const usedToday = num(daily[r.game]);
  tp = Math.max(0, Math.min(tp, g[3] - usedToday));
  daily[r.game] = usedToday + tp;
  me.row[C.DAILY] = JSON.stringify(daily);

  const stage = jparse(me.row[C.STAGE], {});
  let newBest = false;
  const st = clamp(num(r.stage), 0, 999);
  if (r.game === 'volley' && num(stage.volley) > 8) delete stage.volley;   // 미니 시절 점수 기록 → 메인(스테이지) 기록으로 바꿈
  if (g[1] === 'main' && r.cleared && st > num(stage[r.game])) { stage[r.game] = st; newBest = true; }
  if (g[1] !== 'main' && num(r.score) > num(stage[r.game])) { stage[r.game] = num(r.score); newBest = true; }
  me.row[C.STAGE] = JSON.stringify(stage);
  me.row[C.TP] = num(me.row[C.TP]) + tp;
  me.row[C.LAST] = now_();
  let gem = 0;
  if (g[1] === 'main' && r.cleared) gem = 1 + (st % 5 === 0 ? 2 : 0);
  me.row[C.GEM] = num(me.row[C.GEM]) + gem;
  writeStudentRow(me.sheet, me.idx, me.row);
  appendLogs_(SH.LOG, [[now_(), no, me.row[C.NAME], me.row[C.TEAM], g[0], num(r.score), st, r.cleared ? 'O' : 'X', tp, sec, String(r.flag || '').slice(0, 60)]]);

  let mission = null;
  try { mission = checkTeamMission_(me.row[C.TEAM], no, clsOf_(no)); } catch (e) { }
  return { ok: true, tp: tp, gem: gem, capped: usedToday + tp >= g[3], newBest: newBest, mission: mission, me: profile_(me.row) };
}

/** 팀 미션: 모둠원 (참여율 이상)이 오늘 1판 이상 플레이 → 팀 보너스. 참여 명단은 팀 시트 열에 저장 */
function checkTeamMission_(teamName, no, cls) {
  const members = readStudentsCached().rows.filter(r => clsOf_(r[C.NO]) === cls && tkey_(r[C.TEAM]) === tkey_(teamName)).length || 1;
  const s = getSettings();
  const need = Math.ceil(members * clamp(num(s['팀미션참여율'], 100), 10, 100) / 100);
  return withLock(function () {
    const teams = readTeams();
    const ti = teamIndex(teams, teamName, cls);
    if (ti < 0) return { played: 0, total: members, done: false };
    const tr = teams.rows[ti];
    let pl = jparse(tr[TC.PLAYED], {});
    if (pl.d !== today_()) pl = { d: today_(), nos: [] };
    if (pl.nos.indexOf(String(no)) < 0) pl.nos.push(String(no));
    tr[TC.PLAYED] = JSON.stringify(pl);
    const doneToday = String(tr[TC.MDONE]) === today_();
    let out;
    if (!doneToday && pl.nos.length >= need) {
      const bonus = num(s['팀미션보너스'], 30);
      tr[TC.BONUS] = num(tr[TC.BONUS]) + bonus; tr[TC.MDONE] = today_();
      out = { played: pl.nos.length, total: members, need: need, done: true, justDone: true, bonus: bonus };
    } else out = { played: pl.nos.length, total: members, need: need, done: doneToday };
    writeTeamRow_(teams, ti);
    return out;
  });
}

/** 팀 레이드: 공유 보스에 데미지 (팀 시트 공유 → 락) */
function raidHit(token, dmg, sec) {
  const me = auth_(token);
  const atk = num(me.row[C.ATK]);
  const maxDmg = Math.round((clamp(num(sec), 0, 120) * 260 + 400) * (1 + atk * 0.12) * 1.6);
  dmg = clamp(Math.round(num(dmg)), 0, maxDmg);
  const cls = clsOf_(me.row[C.NO]);
  return withLock(function () {
    const teams = readTeams();
    const ti = teamIndex(teams, me.row[C.TEAM], cls);
    if (ti < 0) return { ok: false, msg: '팀이 없어요' };
    const tr = teams.rows[ti];
    let lv = num(tr[TC.RLV], 1), hp = num(tr[TC.RHP]), max = num(tr[TC.RMAX], 1);
    hp -= dmg;
    let killed = false, bonus = 0;
    if (hp <= 0) {
      killed = true; bonus = 20 + lv * 10;
      tr[TC.BONUS] = num(tr[TC.BONUS]) + bonus;
      lv++;
      const base = num(getSettings()['레이드기본HP'], 6000);
      max = Math.round(base * Math.pow(lv, 1.35)); hp = max;
    }
    tr[TC.RLV] = lv; tr[TC.RHP] = hp; tr[TC.RMAX] = max;
    writeTeamRow_(teams, ti);
    const k = 'raidlog_' + cls + '_' + tkey_(tr[TC.NAME]);
    const log = jparse(cache().get(k), []);
    log.unshift({ n: me.row[C.NAME], d: dmg, k: killed });
    cache().put(k, JSON.stringify(log.slice(0, 12)), 21600);
    return { ok: true, dmg: dmg, killed: killed, bonus: bonus, raid: { lv: lv, hp: hp, max: max, log: log.slice(0, 12) } };
  });
}
function getRaid(token) {
  const me = auth_(token);
  const cls = clsOf_(me.row[C.NO]);
  const teams = readTeams();
  const ti = teamIndex(teams, me.row[C.TEAM], cls);
  if (ti < 0) return { ok: false };
  const tr = teams.rows[ti];
  return { ok: true, raid: { lv: num(tr[TC.RLV], 1), hp: num(tr[TC.RHP]), max: num(tr[TC.RMAX], 1), log: jparse(cache().get('raidlog_' + cls + '_' + tkey_(tr[TC.NAME])), []) } };
}

/** 순위 (10초 캐시) */
/** 순위: 학생은 자기 반, 교사 TV 화면은 cls 로 지정한 반 */
function getRanking(token, cls) {
  if (token) cls = clsOf_(auth_(token).row[C.NO]);
  return ranking_(cls || '');
}
function ranking_(cls) {
  cls = cls || '';
  const key = rankKey_(cls);
  const c = cache().get(key);
  if (c) return JSON.parse(c);
  const all = readStudentsCached();
  const d = { rows: all.rows.filter(r => clsOf_(r[C.NO]) === cls) };
  const teams = readTeams();
  const mode = String(getSettings()['팀점수방식'] || '합계');
  const tmap = {};
  teams.rows.filter(t => teamCls_(t) === cls).forEach(t => {
    const pl = jparse(t[TC.PLAYED], {});
    tmap[tkey_(t[TC.NAME])] = { name: t[TC.NAME], bonus: num(t[TC.BONUS]), buff: num(t[TC.BUFF]), raidLv: num(t[TC.RLV], 1), sum: 0, members: [], played: pl.d === today_() ? pl.nos.length : 0 };
  });
  d.rows.forEach(r => {
    const t = tmap[tkey_(r[C.TEAM])]; if (!t) return;
    t.sum += num(r[C.TP]);
    t.members.push({ no: r[C.NO], name: r[C.NAME], tp: num(r[C.TP]) });
  });
  const list = Object.keys(tmap).map(k => {
    const t = tmap[k];
    const base = mode === '평균' && t.members.length ? Math.round(t.sum / t.members.length) : t.sum;
    t.total = base + t.bonus;
    t.members.sort((a, b) => b.tp - a.tp);
    t.mvp = t.members[0] ? t.members[0].name : '-';
    return t;
  }).sort((a, b) => b.total - a.total);
  const top = d.rows.map(r => ({ name: r[C.NAME], team: r[C.TEAM], tp: num(r[C.TP]) }))
    .sort((a, b) => b.tp - a.tp).slice(0, 10);
  // 팀 시트에 없는 팀명을 가진 학생 → 모둠 점수에 안 들어감 (교사 화면 경고용)
  const unassigned = d.rows.filter(r => String(r[C.NAME]).trim() && !tmap[tkey_(r[C.TEAM])]).map(r => r[C.NO] + '번 ' + r[C.NAME] + '(' + (String(r[C.TEAM]).trim() || '빈칸') + ')');
  const out = { mode: mode, cls: cls, clsName: clsLabel_(cls), teams: list, top: top, unassigned: unassigned };
  try { cache().put(key, JSON.stringify(out), 10); } catch (e) { }
  return out;
}

/* ------------------------------------------------------------
 *  전체 퀴즈 이벤트 — ScriptProperties 에 보관 (캐시 증발해도 안전)
 * ------------------------------------------------------------ */
/** 전체 퀴즈 이벤트도 반마다 따로 */
function getEvent_(cls) {
  const k = 'event_' + (cls || '');
  const c = cache().get(k);
  if (c) return JSON.parse(c);
  const p = props_().getProperty(k);
  if (p) { try { cache().put(k, p, 21600); } catch (e) { } return JSON.parse(p); }
  return null;
}
function putEvent_(ev, cls) {
  const k = 'event_' + (cls || ''), s = JSON.stringify(ev);
  props_().setProperty(k, s);
  try { cache().put(k, s, 21600); } catch (e) { }
}
/** 제출 현황 {no: {c,n,t}} */
function eventSubs_(id) { return jparse(props_().getProperty('evsub_' + id), {}); }

function eventSubmit(token, eventId, answers) {
  const me = auth_(token);
  const ev = getEvent_(clsOf_(me.row[C.NO]));
  if (!ev || ev.id !== eventId || !ev.active) return { ok: false, msg: '이벤트가 끝났어요' };
  const no = String(me.row[C.NO]);
  if (eventSubs_(ev.id)[no]) return { ok: false, msg: '이미 제출했어요' };
  const res = submitQuiz(token, (answers || []).map(a => ({ id: a.id, choice: a.choice, ms: a.ms, ctx: '전체퀴즈' })));
  withLock(function () {
    const subs = eventSubs_(ev.id);
    subs[no] = { c: res.correct || 0, n: ev.questions.length, t: me.row[C.TEAM] };
    props_().setProperty('evsub_' + ev.id, JSON.stringify(subs));
  });
  return res;
}

/* ------------------------------------------------------------
 *  온라인 대전방 (오목·체스·끝말잇기) – CacheService (수업 중 1시간 이내용)
 * ------------------------------------------------------------ */
function roomKey_(id) { return 'room_' + id; }
/** 방 목록 묶음: 구슬 솜사탕은 반 구분 없이 전체 공개, 나머지(오목·체스)는 지금처럼 반별 */
const ROOM_OPEN_ALL = { candy: true };
function roomIndexKey_(game, no) { return 'rooms_' + game + '_' + (ROOM_OPEN_ALL[game] ? 'all' : clsOf_(no)); }
function getRoom_(id) { return jparse(cache().get(roomKey_(id)), null); }
function putRoom_(room) {
  room.updated = Date.now();
  cache().put(roomKey_(room.id), JSON.stringify(room), 3600);
}
function roomList(token, game) {
  const me = auth_(token);
  const ids = jparse(cache().get(roomIndexKey_(game, me.row[C.NO])), []);
  const all = cache().getAll(ids.map(roomKey_));
  const out = [];
  ids.forEach(id => {
    const v = all[roomKey_(id)]; if (!v) return;
    const r = JSON.parse(v);
    if (r.status !== 'end' && Date.now() - r.updated < 15 * 60000) out.push({ id: r.id, title: r.title, cls: r.cls || '', players: r.players, max: r.max, status: r.status });
  });
  return out;
}
function roomCreate(token, game, max) {
  const me = auth_(token);
  return withLock(function () {
    const id = Utilities.getUuid().slice(0, 6).toUpperCase();
    const room = {
      id: id, game: game, max: clamp(num(max, 2), 2, 6), status: 'wait', ver: 1,
      title: me.row[C.NAME] + '의 방', cls: clsLabel_(clsOf_(me.row[C.NO])),
      players: [{ no: me.row[C.NO], name: me.row[C.NAME], team: me.row[C.TEAM] }],
      state: null
    };
    room.all = room.players.slice();
    putRoom_(room);
    const rk = roomIndexKey_(game, me.row[C.NO]);
    const ids = jparse(cache().get(rk), []);
    ids.unshift(id);
    cache().put(rk, JSON.stringify(ids.slice(0, ROOM_OPEN_ALL[game] ? 80 : 30)), 3600);
    return room;
  });
}
function roomJoin(token, id) {
  const me = auth_(token);
  return withLock(function () {
    const room = getRoom_(id);
    if (!room) return { ok: false, msg: '방이 없어요' };
    if (room.players.some(p => String(p.no) === String(me.row[C.NO]))) return { ok: true, room: room };
    if (room.status !== 'wait') return { ok: false, msg: '이미 시작한 방이에요' };
    if (room.players.length >= room.max) return { ok: false, msg: '방이 꽉 찼어요' };
    room.players.push({ no: me.row[C.NO], name: me.row[C.NAME], team: me.row[C.TEAM] });
    room.all = (room.all || []).concat([room.players[room.players.length - 1]]);
    room.ver++;
    putRoom_(room);
    return { ok: true, room: room };
  });
}
function roomGet(token, id) {
  auth_(token);
  return getRoom_(id);
}
/** 낙관적 동시성: ver가 같을 때만 상태 갱신 */
function roomPush(token, id, ver, state, status) {
  auth_(token);
  return withLock(function () {
    const room = getRoom_(id);
    if (!room) return { ok: false, msg: '방이 없어요' };
    if (room.ver !== ver) return { ok: false, conflict: true, room: room };
    room.state = state;
    if (status) room.status = status;
    room.ver++;
    putRoom_(room);
    return { ok: true, room: room };
  });
}
/** 실시간 1:1 (구슬 솜사탕): 각자 자기 칸에만 쓰고(잠금 없음) 상대 칸을 읽어 옴. 3초에 한 번 호출 */
function roomSync(token, id, mine) {
  const me = auth_(token);
  const no = String(me.row[C.NO]), c = cache();
  if (mine) {
    let js = JSON.stringify(mine);
    if (js.length > 30000) { mine.b = ''; js = JSON.stringify(mine); }
    c.put('rs_' + id + '_' + no, js, 1800);
  }
  const room = getRoom_(id);
  if (!room) return { ok: false, gone: true };
  let others = room.players.filter(p => String(p.no) !== no);
  if (!others.length && room.all) others = room.all.filter(p => String(p.no) !== no);   // 상대가 나간 뒤에도 마지막 상태는 읽음
  const opp = others.length ? jparse(c.get('rs_' + id + '_' + others[0].no), null) : null;
  return { ok: true, status: room.status, left: (room.state && room.state.left) || '', opp: opp, oppName: others.length ? String(others[0].name) : '' };
}
function roomLeave(token, id) {
  const me = auth_(token);
  return withLock(function () {
    const room = getRoom_(id);
    if (!room) return { ok: true };
    room.players = room.players.filter(p => String(p.no) !== String(me.row[C.NO]));
    if (room.status === 'play' && room.game !== 'word') {
      room.status = 'end'; room.state = Object.assign({}, room.state || {}, { left: me.row[C.NAME] });
    }
    if (room.status === 'play' && room.game === 'word') {
      room.state = Object.assign({}, room.state || {}, { left: me.row[C.NAME] });
      if (room.players.length < 2) room.status = 'end';
    }
    if (!room.players.length) room.status = 'end';
    room.ver++;
    putRoom_(room);
    return { ok: true };
  });
}

/* ------------------------------------------------------------
 *  교사 API  (pw = 설정 시트의 교사비밀번호)
 * ------------------------------------------------------------ */
function tAuth_(pw) {
  if (String(pw) !== String(getSettings()['교사비밀번호'])) throw new Error('TEACHER_AUTH');
}
function teacherLogin(pw) {
  try { tAuth_(pw); return { ok: true, boot: bootInfo_() }; } catch (e) { return { ok: false, msg: '비밀번호가 틀렸어요' }; }
}
/** 교사 화면: cls(반)를 고르면 그 반만 보여 줌 */
function tDashboard(pw, cls) {
  tAuth_(pw);
  // 예전 버전에서 '반' 칸이 날짜로 바뀌어 생긴 문제를 한 번 자동 정리
  if (!props_().getProperty('teamfix_v1')) { try { withLock(fixTeamSheet_); } catch (e) { } }
  const all = readStudents();
  const s = getSettings();
  const classes = classList_();
  if (cls == null || (classes.indexOf(cls) < 0 && cls !== '')) cls = classes[0] || '';
  const allSeen = cache().getAll(all.rows.map(r => 'seen_' + r[C.NO]));
  const nowMs0 = Date.now();
  const clsInfo = classes.map(c => {
    const rows = all.rows.filter(r => clsOf_(r[C.NO]) === c);
    return { id: c, label: clsLabel_(c), count: rows.length, online: rows.filter(r => { const t = num(allSeen['seen_' + r[C.NO]]); return t && nowMs0 - t < 60000; }).length };
  });
  const legacy = all.rows.filter(r => !clsOf_(r[C.NO])).length;
  if (legacy) clsInfo.push({ id: '', label: '기본반(예전 번호)', count: legacy, online: 0 });
  const d = { rows: all.rows.filter(r => clsOf_(r[C.NO]) === cls) };
  const seen = allSeen;
  const ev = getEvent_(cls);
  let evInfo = null;
  if (ev) {
    const subs = eventSubs_(ev.id);
    evInfo = { id: ev.id, active: ev.active, n: ev.questions.length, answered: Object.keys(subs).length, endsAt: ev.endsAt, result: ev.result || null };
  }
  const nowMs = Date.now();
  return {
    students: d.rows.map(r => {
      const p = profile_(r);
      const t = num(seen['seen_' + r[C.NO]]);
      p.online = t && nowMs - t < 60000;
      return p;
    }),
    ranking: ranking_(cls),
    teamSlots: teamSlots_(cls, all.rows),
    cls: cls, clsName: clsLabel_(cls), classes: clsInfo,
    openGames: String(s['열린게임'] || '').split(',').map(x => x.trim()).filter(String),
    notice: s['공지'] || '',
    mode: s['팀점수방식'] || '합계',
    quizCount: getQuizBank_().length,
    event: evInfo,
    boot: bootInfo_()
  };
}
function tSetOpenGames(pw, list) { tAuth_(pw); setSetting('열린게임', (list || []).join(',')); return { ok: true }; }
function tSetNotice(pw, text) { tAuth_(pw); setSetting('공지', String(text || '').slice(0, 200)); return { ok: true }; }
function tSetMode(pw, mode) { tAuth_(pw); setSetting('팀점수방식', mode === '평균' ? '평균' : '합계'); bumpRank_(); return { ok: true }; }
function tRefreshQuiz(pw) { tAuth_(pw); stuDirty_(); return { ok: true, count: refreshQuizCache().length }; }

function tStartEvent(pw, n, secPerQ, cls) {
  tAuth_(pw); cls = cls || '';
  return withLock(function () {
    n = clamp(num(n, 5), 1, 15); secPerQ = clamp(num(secPerQ, 20), 5, 120);
    const bank = getQuizBank_();
    const usedStr = String(getSettings()['이벤트사용문제'] || '');
    let used = new Set(usedStr.split(',').filter(String));
    let avail = bank.filter(q => !used.has(q.id));
    if (avail.length < n) { used = new Set(); avail = bank.slice(); }
    shuffle(avail);
    const qs = avail.slice(0, n);
    qs.forEach(q => used.add(q.id));
    setSetting('이벤트사용문제', Array.from(used).join(','));
    const ev = {
      id: 'E' + Date.now().toString(36), active: true, secPerQ: secPerQ,
      endsAt: Date.now() + (n * secPerQ + 60) * 1000, questions: qs.map(packQuiz_)
    };
    putEvent_(ev, cls);
    return { ok: true, id: ev.id, n: qs.length };
  });
}
/** 이벤트 종료: 팀별 (정답률×참여율) → 공격버프% + 순위 보너스 */
function tEndEvent(pw, cls) {
  tAuth_(pw); cls = cls || '';
  return withLock(function () {
    const ev = getEvent_(cls);
    if (!ev) return { ok: false, msg: '진행 중인 이벤트가 없어요' };
    if (!ev.active) return { ok: false, msg: '이미 종료된 이벤트예요' };
    const d = { rows: readStudents().rows.filter(r => clsOf_(r[C.NO]) === cls) };
    const subs = eventSubs_(ev.id);
    const agg = {};
    Object.keys(subs).forEach(k => {
      const v = subs[k];
      const tk = tkey_(v.t);
      agg[tk] = agg[tk] || { c: 0, n: 0, p: 0 };
      agg[tk].c += v.c; agg[tk].n += v.n; agg[tk].p++;
    });
    const teams = readTeams();
    const result = teams.rows.map((tr, i) => ({ tr, i })).filter(x => teamCls_(x.tr) === cls).map(({ tr, i }) => {
      const a = agg[tkey_(tr[TC.NAME])] || { c: 0, n: 0, p: 0 };
      const size = d.rows.filter(r => tkey_(r[C.TEAM]) === tkey_(tr[TC.NAME])).length || 1;
      const rate = a.n ? (a.c / a.n) * (a.p / size) : 0;
      return { i: i, name: tr[TC.NAME], rate: Math.round(rate * 100), people: a.p, size: size };
    }).sort((x, y) => y.rate - x.rate);
    const bonusByRank = [40, 25, 15, 10, 5, 5, 5, 5];
    result.forEach((r, rank) => {
      const tr = teams.rows[r.i];
      r.buff = Math.round(r.rate * 0.3);
      r.bonus = r.rate > 0 ? bonusByRank[rank] || 5 : 0;
      tr[TC.BUFF] = r.buff;
      tr[TC.BONUS] = num(tr[TC.BONUS]) + r.bonus;
      writeTeamRow_(teams, r.i);
    });
    ev.active = false; ev.result = result;
    putEvent_(ev, cls);
    props_().deleteProperty('evsub_' + ev.id);
    return { ok: true, result: result };
  });
}
function tGiveTeamTP(pw, teamName, amount, cls) {
  tAuth_(pw);
  return withLock(function () {
    const teams = readTeams();
    const ti = teamIndex(teams, teamName, cls || '');
    if (ti < 0) return { ok: false };
    teams.rows[ti][TC.BONUS] = num(teams.rows[ti][TC.BONUS]) + num(amount);
    writeTeamRow_(teams, ti);
    return { ok: true };
  });
}
function tGiveStudent(pw, no, tp, gem) {
  tAuth_(pw);
  const d = readStudents();
  for (let i = 0; i < d.rows.length; i++) {
    if (String(d.rows[i][C.NO]) === String(no)) {
      d.rows[i][C.TP] = num(d.rows[i][C.TP]) + num(tp);
      d.rows[i][C.GEM] = num(d.rows[i][C.GEM]) + num(gem);
      writeStudentRow(d.sheet, i, d.rows[i]);
      return { ok: true };
    }
  }
  return { ok: false };
}
/** 교사: 학생 모둠 옮기기 (정원과 상관없이 가능, 선택 완료로 고정) */
function tMoveTeam(pw, no, team) {
  tAuth_(pw);
  team = String(team || '');
  if (TEAM_NAMES.indexOf(team) < 0) return { ok: false, msg: '없는 모둠' };
  return withLock(function () {
    const d = readStudents();
    for (let i = 0; i < d.rows.length; i++) {
      if (String(d.rows[i][C.NO]) === String(no)) {
        d.sheet.getRange(i + 2, C.TEAM + 1, 1, 2).setValues([[team, PICKED]]);
        stuDirty_();
        const cls = clsOf_(no); if (cls) ensureClassTeams_(cls);
        return { ok: true };
      }
    }
    return { ok: false, msg: '학생을 찾지 못했어요' };
  });
}
/** 교사: 모둠 선택 초기화 — no 를 주면 그 학생만, 아니면 그 반 전체. 다음 로그인 때 다시 고름 */
function tResetTeamPick(pw, cls, no) {
  tAuth_(pw);
  return withLock(function () {
    const d = readStudents();
    let n = 0;
    d.rows.forEach((r, i) => {
      if (no != null && no !== '' ? String(r[C.NO]) === String(no) : clsOf_(r[C.NO]) === String(cls == null ? '' : cls)) {
        if (isPicked_(r)) { d.sheet.getRange(i + 2, C.PICK + 1).setValue(''); n++; }
      }
    });
    stuDirty_();
    return { ok: true, count: n };
  });
}
function tResetQuizUsage(pw, cls) {
  tAuth_(pw);
  if (cls == null) { resetQuizUsage_(); return { ok: true }; }
  const d = readStudents();
  d.rows.forEach((r, i) => { if (clsOf_(r[C.NO]) === cls) d.sheet.getRange(i + 2, C.USED + 1).setValue(''); });
  stuDirty_();
  return { ok: true };
}
function resetQuizUsageMenu() { resetQuizUsage_(); }
function resetQuizUsage_() {
  const d = readStudents();
  if (!d.rows.length) return;
  d.sheet.getRange(2, C.USED + 1, d.rows.length, 1).setValue('');
  setSetting('이벤트사용문제', '');
  stuDirty_();
}
/**
 * 반(방) 데이터 삭제 — 고른 반만, 다른 반은 그대로
 *  mode 'score' : TP·팀 보너스·버프·레이드·미션 초기화 (스탯·강화석·최고기록 유지)
 *  mode 'all'   : 위 + 스탯·강화석·최고기록·정답률·푼 문제 기록까지 초기화 (명단·이름·모둠은 유지)
 *  mode 'delete': 그 반 학생 명단을 시트에서 지우고 모둠도 초기화 (다시 로그인하면 새로 등록됨)
 */
function tResetClass(pw, cls, mode) {
  tAuth_(pw);
  cls = cls == null ? '' : String(cls);
  return withLock(function () {
    const d = readStudents();
    const idx = []; d.rows.forEach((r, i) => { if (clsOf_(r[C.NO]) === cls) idx.push(i); });
    if (mode === 'delete') {
      for (let k = idx.length - 1; k >= 0; k--) d.sheet.deleteRow(idx[k] + 2);
    } else {
      idx.forEach(i => {
        const r = d.rows[i];
        r[C.TP] = 0; r[C.DAILY] = '';
        if (mode === 'all') { r[C.GEM] = 3; r[C.ATK] = r[C.HP] = r[C.SPD] = r[C.CRT] = r[C.LCK] = 0; r[C.STAGE] = '{}'; r[C.USED] = ''; r[C.CORRECT] = 0; r[C.SOLVED] = 0; r[C.CYCLE] = 0; r[C.WRONG] = ''; }
        d.sheet.getRange(i + 2, 1, 1, STU_HEADER.length).setValues([r]);
      });
    }
    const teams = readTeams();
    const base = num(getSettings()['레이드기본HP'], 6000);
    teams.rows.forEach((t, i) => {
      if (teamCls_(t) !== cls) return;
      t[TC.BONUS] = 0; t[TC.BUFF] = 0; t[TC.RLV] = 1; t[TC.RHP] = base; t[TC.RMAX] = base; t[TC.MDONE] = ''; t[TC.PLAYED] = '';
      writeTeamRow_(teams, i);
      cache().remove('raidlog_' + cls + '_' + tkey_(t[TC.NAME]));
    });
    props_().deleteProperty('event_' + cls); cache().remove('event_' + cls);
    stuDirty_();
    return { ok: true, n: idx.length };
  });
}
/** 새 시즌(모든 반): TP·팀보너스·버프·레이드 초기화 (스탯/강화석은 유지 여부 선택) */
function tNewSeason(pw, keepStats) {
  tAuth_(pw);
  return withLock(function () {
    const d = readStudents();
    d.rows.forEach(r => {
      r[C.TP] = 0; r[C.DAILY] = '';
      if (!keepStats) { r[C.GEM] = 3; r[C.ATK] = r[C.HP] = r[C.SPD] = r[C.CRT] = r[C.LCK] = 0; r[C.STAGE] = '{}'; }
    });
    if (d.rows.length) d.sheet.getRange(2, 1, d.rows.length, STU_HEADER.length).setValues(d.rows);
    const teams = readTeams();
    const base = num(getSettings()['레이드기본HP'], 6000);
    teams.rows.forEach((t, i) => {
      t[TC.BONUS] = 0; t[TC.BUFF] = 0; t[TC.RLV] = 1; t[TC.RHP] = base; t[TC.RMAX] = base; t[TC.MDONE] = ''; t[TC.PLAYED] = '';
      writeTeamRow_(teams, i);
    });
    stuDirty_();
    return { ok: true };
  });
}

/** 기존 퀴즈 시트에 샘플 문항 중 아직 없는 것(문제 텍스트 기준)만 뒤에 추가 */
function appendSampleQuizzes(silent) {
  const q = ss_().getSheetByName(SH.QUIZ);
  if (!q) { setup(); return; }
  const n = q.getLastRow() - 1;
  const have = new Set(n > 0 ? q.getRange(2, 5, n, 1).getValues().map(r => String(r[0]).trim()) : []);
  const ids = new Set(n > 0 ? q.getRange(2, 1, n, 1).getValues().map(r => String(r[0]).trim()) : []);
  let k = n + 1;
  const rows = [];
  sampleQuizzes().concat(extraQuizzes()).forEach(r => {
    if (have.has(String(r[3]).trim())) return;
    have.add(String(r[3]).trim());
    let id; do { id = 'S' + (k++); } while (ids.has(id));
    rows.push([id].concat(r));
  });
  if (rows.length) q.getRange(q.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  refreshQuizCache();
  if (silent !== true) { try { SpreadsheetApp.getUi().alert(rows.length + '문항을 추가했어요. (총 ' + (n + rows.length) + '문항)'); } catch (e) { } }
  return rows.length;
}

/** 중1 체육·건강 추가 문항 300개 (건강·체력 / 스포츠·경기 / 안전·응급처치·운동과학·표현) — [학년, 분야, 난이도, 문제, 보기1~4, 정답번호, 해설] */
function extraQuizzes() {
  return [
    ["", "체력", 1, "근육이 한 번에 낼 수 있는 최대의 힘을 무엇이라 할까?", "유연성", "근력", "평형성", "근지구력", 2, "한 번에 내는 최대 힘이 근력이다."],
    ["", "체력", 1, "관절을 움직일 수 있는 범위가 넓은 능력은?", "근력", "유연성", "순발력", "스피드", 2, "관절 가동 범위가 넓은 능력이 유연성이다."],
    ["", "체력", 1, "몸의 방향을 빠르게 바꾸며 움직이는 능력은?", "근력", "유연성", "평형성", "민첩성", 4, "빠르게 방향을 바꾸는 능력이 민첩성이다."],
    ["", "체력", 1, "눈과 손발 등 여러 부위를 조화롭게 움직이는 능력은?", "협응성", "심폐지구력", "유연성", "근지구력", 1, "신체 부위를 조화롭게 쓰는 능력이 협응성이다."],
    ["", "체력", 1, "출발 신호를 듣고 몸이 움직이기까지 걸리는 시간은?", "회복시간", "운동시간", "반응시간", "휴식시간", 3, "자극 후 움직임 시작까지가 반응시간이다."],
    ["", "체력", 1, "PAPS 악력 검사로 측정하는 체력 요소는?", "유연성", "근력", "심폐지구력", "민첩성", 2, "악력은 손으로 쥐는 최대 힘, 즉 근력이다."],
    ["", "체력", 1, "학생건강체력평가제도를 줄여 부르는 말은?", "BMI", "PAPS", "FITT", "RICE", 2, "Physical Activity Promotion System의 약자다."],
    ["", "체력", 1, "PAPS 윗몸말아올리기로 주로 측정하는 체력 요소는?", "평형성", "근지구력", "순발력", "유연성", 2, "복근을 반복해 쓰는 능력, 근지구력을 본다."],
    ["", "체력", 1, "악력 검사 결과를 기록하는 단위는?", "초", "cm", "kg", "회", 3, "쥐는 힘을 킬로그램(kg)으로 기록한다."],
    ["", "체력", 1, "유연성을 기르는 데 가장 알맞은 활동은?", "악력기 쥐기", "요가·스트레칭", "50m 전력질주", "팔씨름", 2, "근육을 늘리는 스트레칭이 유연성을 기른다."],
    ["", "체력", 1, "운동량을 조금씩 늘려 가야 한다는 운동 원리는?", "개별성의 원리", "가역성의 원리", "점진성의 원리", "특이성의 원리", 3, "부하를 단계적으로 늘리는 것이 점진성이다."],
    ["", "체력", 1, "사람마다 체력이 달라 운동도 다르게 해야 한다는 원리는?", "개별성의 원리", "과부하의 원리", "가역성의 원리", "점진성의 원리", 1, "개인 특성에 맞추는 것이 개별성이다."],
    ["", "체력", 1, "운동 처방 FITT 원리에서 F가 뜻하는 것은?", "시간(얼마나 오래)", "빈도(얼마나 자주)", "형태(어떤 운동)", "강도(얼마나 힘들게)", 2, "F는 Frequency, 운동 빈도다."],
    ["", "체력", 1, "운동 중 가슴 통증이나 심한 어지럼이 느껴지면?", "참고 끝까지 한다", "즉시 멈추고 선생님께 알린다", "물만 마시고 계속한다", "속도를 더 높인다", 2, "위험 신호이므로 바로 멈추고 도움을 청한다."],
    ["", "체력", 2, "농구에서 수비를 피해 빠르게 방향을 바꾸는 데 중요한 체력은?", "민첩성", "평형성", "유연성", "근지구력", 1, "방향 전환 능력이 민첩성이다."],
    ["", "체력", 2, "건강체력끼리 바르게 묶인 것은?", "스피드·유연성", "근력·유연성", "평형성·근력", "순발력·민첩성", 2, "근력과 유연성은 모두 건강체력이다."],
    ["", "체력", 2, "무거운 무게를 적은 횟수로 드는 운동이 주로 기르는 체력은?", "근지구력", "심폐지구력", "근력", "유연성", 3, "고중량 저반복은 근력 향상에 효과적이다."],
    ["", "체력", 2, "근지구력을 기르기에 알맞은 운동 방법은?", "가벼운 무게로 여러 번 반복", "정적 스트레칭 30초", "10초 전력질주 1회", "아주 무거운 무게로 1~2회", 1, "저중량 고반복이 근지구력을 기른다."],
    ["", "체력", 2, "앉아윗몸앞으로굽히기의 올바른 방법은?", "무릎을 펴고 천천히 민다", "반동을 주어 튕기듯 민다", "무릎을 굽혀서 민다", "숨을 참고 빠르게 민다", 1, "무릎을 편 채 반동 없이 천천히 밀어야 한다."],
    ["", "체력", 2, "왕복오래달리기에서 신호음 간격은 갈수록 어떻게 될까?", "점점 길어진다", "항상 같다", "무작위로 바뀐다", "점점 짧아진다", 4, "단계가 오를수록 빨리 달려야 한다."],
    ["", "체력", 2, "PAPS 왕복오래달리기에서 한 번에 달리는 거리는?", "10m", "100m", "50m", "20m", 4, "20m 구간을 신호음에 맞춰 왕복한다."],
    ["", "체력", 2, "PAPS 결과는 보통 몇 개의 등급으로 나뉠까?", "4개", "10개", "5개", "3개", 3, "PAPS는 1~5등급으로 평가한다."],
    ["", "체력", 2, "악력을 잴 때 올바른 자세는?", "팔을 머리 위로 들어", "팔을 몸에 붙이고 흔들며", "팔꿈치를 90도로 굽혀", "팔을 펴서 몸에 닿지 않게", 4, "팔을 자연스럽게 펴고 몸에 대지 않는다."],
    ["", "체력", 2, "운동 중 대화는 되지만 노래는 어렵다면 운동 강도는?", "고강도", "최대 강도", "중강도", "저강도", 3, "말은 되고 노래가 힘들면 중강도다."],
    ["", "체력", 2, "손목에서 맥박을 잴 때 쓰는 손가락은?", "새끼손가락", "엄지", "검지와 중지", "엄지와 검지", 3, "엄지는 자체 맥박이 있어 쓰지 않는다."],
    ["", "체력", 2, "15초 동안 잰 맥박이 30회라면 1분 심박수는?", "120회", "150회", "90회", "60회", 1, "30회×4=120회이다."],
    ["", "체력", 2, "마라톤 선수가 오래달리기 훈련을 주로 하는 것과 관련된 원리는?", "개별성의 원리", "가역성의 원리", "특이성의 원리", "점진성의 원리", 3, "목적에 맞는 운동을 해야 효과가 난다."],
    ["", "체력", 3, "FITT에서 운동 강도(I)를 높인 예로 알맞은 것은?", "같은 거리를 더 빨리 달린다", "주 3회에서 5회로 늘린다", "달리기를 수영으로 바꾼다", "20분에서 30분으로 늘린다", 1, "속도를 높이면 강도가 높아진다."],
    ["", "체력", 3, "PAPS 왕복오래달리기가 끝나는 경우로 알맞은 것은?", "신호음 안 도착 실패가 2회", "10분이 지났을 때", "50회를 채웠을 때", "신호음 안 도착 실패가 1회", 1, "신호음에 두 번 늦으면 검사를 마친다."],
    ["", "체력", 3, "제자리멀리뛰기 기록은 어디까지 잴까?", "발끝이 가장 멀리 닿은 곳", "손이 닿은 가장 먼 곳", "구름선과 가장 가까운 착지 지점", "두 발의 가운데", 3, "구름선에 가장 가까운 신체 착지 지점을 잰다."],
    ["", "체력", 3, "PAPS 결과 4~5등급 학생을 위해 운영되는 프로그램은?", "스포츠클럽 대회", "건강체력교실", "방과후 영어교실", "진로체험교실", 2, "저체력 학생 대상 건강체력교실이 운영된다."],
    ["", "체력", 3, "PAPS 심폐지구력 측정 종목이 아닌 것은?", "오래달리기-걷기", "악력", "스텝검사", "왕복오래달리기", 2, "악력은 근력 측정 종목이다."],
    ["", "체력", 3, "PAPS에서 50m 달리기와 함께 순발력을 재는 종목은?", "윗몸말아올리기", "스텝검사", "제자리멀리뛰기", "악력", 3, "순발력 종목은 50m 달리기와 제자리멀리뛰기다."],
    ["", "체력", 3, "근력 운동 후 같은 근육은 보통 얼마나 쉬게 하는 게 좋을까?", "약 1시간", "쉬지 않는다", "약 1주일", "약 48시간", 4, "근육 회복에 보통 1~2일이 필요하다."],
    ["", "체력", 3, "WHO가 권장하는 청소년 근육·뼈 강화 운동 횟수는?", "주 3일 이상", "매일 3시간", "주 1일", "한 달 2회", 1, "WHO는 주 3일 이상을 권장한다."],
    ["", "체력", 3, "뼈에 자극을 주어 튼튼하게 하는 데 가장 효과적인 운동은?", "수영", "스트레칭", "줄넘기", "실내 자전거", 3, "체중이 실리는 점프 운동이 뼈를 자극한다."],
    ["", "영양", 1, "비타민 C가 많이 들어 있는 음식은?", "흰쌀밥", "식용유", "귤·키위", "버터", 3, "과일에 비타민 C가 풍부하다."],
    ["", "영양", 1, "식품 영양성분표에서 확인할 수 있는 것은?", "요리하는 방법", "생산자 이름", "판매 가격 변화", "나트륨·당류 함량", 4, "영양성분표에 열량과 영양소 함량이 적힌다."],
    ["", "영양", 1, "나트륨을 너무 많이 먹으면 생기기 쉬운 질환은?", "골절", "고혈압", "근시", "충치", 2, "나트륨 과다는 혈압을 높인다."],
    ["", "영양", 1, "라면 국물을 덜 먹으면 특히 줄일 수 있는 성분은?", "비타민 C", "나트륨", "식이섬유", "칼슘", 2, "국물에 소금(나트륨)이 많다."],
    ["", "영양", 1, "에너지 음료에 많이 들어 있어 주의가 필요한 성분은?", "카페인", "식이섬유", "칼슘", "단백질", 1, "고카페인은 청소년에게 해로울 수 있다."],
    ["", "영양", 2, "비타민과 함께 몸의 기능을 조절하는 영양소는?", "지방", "단백질", "탄수화물", "무기질", 4, "비타민·무기질·물은 조절 영양소다."],
    ["", "영양", 2, "5대 영양소에 속하지 않는 것은?", "무기질", "비타민", "식이섬유", "지방", 3, "5대 영양소는 탄·단·지·비타민·무기질이다."],
    ["", "영양", 2, "밤에 잘 보이지 않는 야맹증과 관련 깊은 비타민은?", "비타민 A", "비타민 C", "비타민 B1", "비타민 K", 1, "비타민 A가 부족하면 야맹증이 생긴다."],
    ["", "영양", 2, "햇빛을 쬐면 몸속에서 만들어지는 비타민은?", "비타민 E", "비타민 A", "비타민 C", "비타민 D", 4, "피부가 자외선을 받아 비타민 D를 만든다."],
    ["", "영양", 2, "식이섬유가 많은 음식을 먹으면 좋은 점은?", "혈당 급상승", "변비 예방", "체온 급상승", "근육량 급증", 2, "식이섬유는 장운동을 돕는다."],
    ["", "영양", 2, "목이 마르다고 느낄 때 우리 몸은?", "수분이 넘치는 상태", "체온이 낮아진 상태", "소화가 끝난 상태", "이미 수분이 부족한 상태", 4, "갈증은 탈수가 시작됐다는 신호다."],
    ["", "영양", 2, "소변 색으로 볼 때 수분이 충분한 상태는?", "붉은색", "진한 주황색", "진한 갈색", "연한 노란색", 4, "수분이 충분하면 소변이 연한 색이다."],
    ["", "영양", 2, "트랜스지방이 많이 들어 있기 쉬운 음식은?", "튀김·가공 과자", "생선구이", "현미밥", "생채소", 1, "튀김과 가공 과자에 트랜스지방이 많다."],
    ["", "영양", 3, "영양성분표의 '1일 영양성분 기준치 %'가 뜻하는 것은?", "남은 유통기한 비율", "음식 속 수분 비율", "하루 기준량 중 차지하는 비율", "제품의 할인율", 3, "하루 기준치 대비 함량을 %로 보여 준다."],
    ["", "영양", 3, "식품구성자전거의 앞바퀴가 뜻하는 것은?", "우유류", "물", "채소류", "곡류", 2, "앞바퀴는 충분한 물 섭취를 뜻한다."],
    ["", "영양", 3, "식품구성자전거에서 가장 넓은 면적을 차지하는 식품군은?", "유지·당류", "우유·유제품류", "곡류", "과일류", 3, "곡류를 가장 많이 먹도록 권장한다."],
    ["", "영양", 3, "WHO 권장 첨가당 섭취량은 하루 총 열량의 몇 % 미만?", "30%", "1%", "10%", "50%", 3, "WHO는 유리당을 10% 미만으로 권장한다."],
    ["", "영양", 3, "운동 중 땀으로 수분과 함께 많이 빠져나가는 무기질은?", "요오드", "인", "철", "나트륨", 4, "땀에는 나트륨(염분)이 들어 있다."],
    ["", "영양", 3, "식약처의 청소년 카페인 하루 최대 섭취 권고량은?", "체중 1kg당 2.5mg 이하", "제한 없음", "하루 1,000mg 이하", "체중 1kg당 25mg 이하", 1, "식약처는 체중 1kg당 2.5mg 이하를 권고한다."],
    ["", "영양", 3, "식사 직후 격렬한 운동이 좋지 않은 이유는?", "소화기로 갈 혈액이 근육으로 가서", "뼈가 약해져서", "키가 줄어서", "시력이 나빠져서", 1, "혈액이 근육으로 몰려 소화가 방해된다."],
    ["", "건강", 1, "체지방이 지나치게 많이 쌓인 상태를 무엇이라 할까?", "비만", "빈혈", "저체중", "탈수", 1, "과도한 체지방 축적이 비만이다."],
    ["", "건강", 1, "비만을 예방하는 바람직한 방법은?", "단식 후 폭식", "끼니 굶기", "운동만 하고 아무거나 먹기", "규칙적 운동과 균형 식사", 4, "식사와 운동을 함께 관리해야 한다."],
    ["", "건강", 1, "기침할 때 올바른 기침 예절은?", "그냥 하기", "고개만 돌리기", "손바닥으로 가리기", "옷소매로 입과 코 가리기", 4, "옷소매로 가려야 손을 통한 전파를 막는다."],
    ["", "건강", 1, "독감(인플루엔자)을 예방하는 가장 효과적인 방법은?", "예방접종", "찬물 샤워", "비타민만 먹기", "항생제 미리 먹기", 1, "독감은 예방접종으로 예방한다."],
    ["", "건강", 1, "올바른 손 씻기 방법은?", "물로만 빠르게", "손바닥만 문지르기", "손등만 씻기", "비누로 손톱 밑까지", 4, "손가락 사이·손톱 밑까지 비누로 씻는다."],
    ["", "건강", 1, "식중독을 예방하는 방법으로 알맞은 것은?", "음식을 충분히 익혀 먹기", "손 안 씻고 조리", "남은 음식 실온 보관", "생고기 도마에 채소 썰기", 1, "충분히 익히면 세균이 죽는다."],
    ["", "건강", 1, "담배 연기 속에서 중독을 일으키는 물질은?", "카페인", "비타민", "칼슘", "니코틴", 4, "니코틴은 강한 중독성을 가진다."],
    ["", "건강", 1, "간접흡연에 대한 설명으로 옳은 것은?", "밖에서 맡으면 무해하다", "어린이에겐 영향이 없다", "냄새만 날 뿐 무해하다", "안 피워도 연기를 마시면 해롭다", 4, "간접흡연도 건강에 해롭다."],
    ["", "건강", 1, "친구가 담배를 권할 때 가장 올바른 대처는?", "분위기를 위해 따른다", "몰래 받아 둔다", "한 번만 피운다", "분명하게 거절한다", 4, "단호한 거절이 가장 좋은 대처다."],
    ["", "건강", 1, "스트레스 관리에 도움이 되는 호흡법은?", "입으로만 헐떡이기", "짧고 빠르게 숨쉬기", "천천히 깊게 숨쉬기", "숨을 오래 참기", 3, "느린 복식호흡은 긴장을 풀어 준다."],
    ["", "건강", 1, "고민이 오래가고 혼자 해결하기 어려울 때 좋은 행동은?", "상담 선생님께 도움 요청", "밤새 게임하기", "혼자 참고 숨기기", "아무에게도 말 안 하기", 1, "믿을 만한 어른과 상담하는 것이 좋다."],
    ["", "건강", 2, "체중은 정상인데 체지방률이 높은 상태를 부르는 말은?", "고도 비만", "마른 비만", "저체중", "근육형 체형", 2, "체중은 정상이어도 체지방이 많으면 마른 비만이다."],
    ["", "건강", 2, "복부 비만을 확인할 때 재는 것은?", "발 길이", "허리둘레", "앉은키", "손목둘레", 2, "허리둘레로 복부 지방을 가늠한다."],
    ["", "건강", 2, "사춘기 2차 성징이 나타나는 주된 원인은?", "카페인 섭취", "성호르몬 분비", "수면 부족", "운동 부족", 2, "성호르몬이 늘면서 2차 성징이 나타난다."],
    ["", "건강", 2, "모기가 옮기는 감염병은?", "수두", "독감", "일본뇌염", "결핵", 3, "일본뇌염은 모기가 옮긴다."],
    ["", "건강", 2, "항생제를 처방받았을 때 올바른 복용법은?", "친구와 나눠 먹는다", "좋아지면 바로 끊는다", "두 배로 먹는다", "처방 기간을 끝까지 지킨다", 4, "중간에 끊으면 내성균이 생길 수 있다."],
    ["", "건강", 2, "전자담배에 대한 설명으로 옳은 것은?", "금연 약과 같다", "니코틴으로 중독될 수 있다", "청소년도 사도 된다", "수증기라서 무해하다", 2, "전자담배에도 니코틴과 유해물질이 있다."],
    ["", "건강", 2, "청소년 음주가 특히 위험한 이유는?", "키가 다 커서", "뇌가 발달 중이라서", "술이 약하게 작용해서", "간이 더 튼튼해서", 2, "발달 중인 뇌는 알코올 손상이 크다."],
    ["", "건강", 2, "약을 정해진 방법과 다르게 쓰거나 많이 쓰는 것은?", "약물 오남용", "건강 검진", "응급 처치", "예방 접종", 1, "잘못 쓰거나 과하게 쓰는 것이 오남용이다."],
    ["", "건강", 2, "운동이 기분을 좋게 하는 이유와 관련된 물질은?", "니코틴", "카페인", "알코올", "엔도르핀", 4, "운동하면 기분을 좋게 하는 엔도르핀이 나온다."],
    ["", "건강", 3, "BMI의 한계로 알맞은 것은?", "근육과 지방을 구분 못 함", "계산이 불가능함", "키를 쓰지 않음", "어린이만 쓸 수 있음", 1, "근육이 많아도 BMI가 높게 나올 수 있다."],
    ["", "건강", 3, "키 150cm, 몸무게 45kg인 학생의 BMI는?", "15", "20", "25", "30", 2, "45÷(1.5×1.5)=20이다."],
    ["", "건강", 3, "청소년 비만 판정에 BMI 백분위수를 쓰는 이유는?", "어른과 기준이 같아서", "몸무게가 일정해서", "나이·성별에 따라 기준이 달라서", "키를 잴 수 없어서", 3, "성장기라 성별·연령별 기준을 쓴다."],
    ["", "건강", 3, "감염병 발생의 3요소에 해당하지 않는 것은?", "숙주(사람)", "감염 경로", "운동량", "병원체", 3, "병원체·감염 경로·숙주가 3요소다."],
    ["", "건강", 3, "감기 바이러스에 항생제가 효과가 없는 이유는?", "항생제가 진통제라서", "항생제는 세균에 작용해서", "감기는 병이 아니라서", "바이러스가 너무 커서", 2, "항생제는 세균을 죽이는 약이다."],
    ["", "건강", 3, "담배 연기에서 혈액의 산소 운반을 방해하는 기체는?", "질소", "산소", "일산화탄소", "수소", 3, "일산화탄소가 헤모글로빈과 먼저 결합한다."],
    ["", "건강", 3, "약물 중독에서 '내성'이 뜻하는 것은?", "같은 효과에 더 많은 양 필요", "약을 끊기 쉬워짐", "부작용이 사라짐", "약효가 강해짐", 1, "내성이 생기면 점점 양이 늘어난다."],
    ["", "건강", 3, "적당해서 도움이 되는 좋은 스트레스를 무엇이라 할까?", "트라우마", "유스트레스", "디스트레스", "번아웃", 2, "긍정적 스트레스를 유스트레스라 한다."],
    ["", "건강", 3, "스트레스를 받을 때 분비되는 대표 호르몬은?", "인슐린", "멜라토닌", "성장호르몬", "코르티솔", 4, "코르티솔은 스트레스 호르몬이다."],
    ["", "생활습관", 1, "좋은 수면 습관으로 알맞은 것은?", "밤늦게 카페인 마시기", "주말에 몰아서 자기", "자기 전 게임하기", "매일 같은 시간에 자고 일어나기", 4, "규칙적인 수면이 생체 리듬을 지킨다."],
    ["", "생활습관", 1, "잠이 부족할 때 나타나기 쉬운 것은?", "집중력·기억력 저하", "기분 안정", "키 성장 촉진", "면역력 향상", 1, "수면 부족은 학습 능력을 떨어뜨린다."],
    ["", "생활습관", 1, "스마트폰 과의존을 줄이는 방법으로 알맞은 것은?", "알림을 모두 켜기", "식사 중 사용하기", "침대에서 사용하기", "사용 시간을 정해 두기", 4, "스스로 시간을 정하면 조절에 도움 된다."],
    ["", "생활습관", 1, "이어폰으로 큰 소리를 오래 들으면 생길 수 있는 것은?", "소음성 난청", "거북목", "충치", "근시", 1, "큰 소리에 오래 노출되면 청력이 손상된다."],
    ["", "생활습관", 1, "키 성장에 도움이 되지 않는 생활습관은?", "충분한 수면", "골고루 먹기", "규칙적인 운동", "늦게까지 스마트폰 하기", 4, "늦게 자면 성장에 필요한 수면이 줄어든다."],
    ["", "생활습관", 2, "자기 전 스마트폰이 잠을 방해하는 이유는?", "배터리 열 때문에", "전자파로 근육이 굳어서", "빛이 멜라토닌 분비를 막아서", "소리가 작아서", 3, "화면 빛이 수면 호르몬 분비를 줄인다."],
    ["", "생활습관", 2, "밤에 분비되어 잠을 오게 하는 호르몬은?", "코르티솔", "아드레날린", "멜라토닌", "인슐린", 3, "멜라토닌은 수면을 유도한다."],
    ["", "생활습관", 2, "스마트폰 과의존의 특징으로 알맞은 것은?", "사용을 스스로 조절하기 어려움", "필요할 때만 사용", "공부에만 사용", "하루 10분만 사용", 1, "조절 실패가 과의존의 핵심 특징이다."],
    ["", "생활습관", 2, "공부할 때 화면(모니터)의 알맞은 위치는?", "눈높이나 약간 아래", "배꼽 높이", "바닥", "머리 위 높이", 1, "눈높이에 맞춰야 목에 부담이 적다."],
    ["", "생활습관", 2, "다음 중 '좌식 행동'에 해당하는 것은?", "걸어서 등교하기", "앉아서 오래 영상 보기", "계단 오르기", "자전거 타기", 2, "앉거나 누워 에너지 소비가 적은 행동이다."],
    ["", "생활습관", 3, "눈 건강을 위한 '20-20-20 규칙'은?", "하루 20회 눈 감기", "20분 자고 20분 깨기", "20분마다 20초간 먼 곳 보기", "20cm 거리에서 보기", 3, "20분마다 약 6m 먼 곳을 20초간 본다."],
    ["", "생활습관", 3, "이어폰 사용 시 권장되는 '60-60 규칙'은?", "60cm 거리 유지", "60세까지 사용", "60초마다 끄기", "음량 60% 이하, 60분 이내", 4, "음량과 시간을 함께 줄여 청력을 지킨다."],
    ["", "생활습관", 3, "게임을 조절하지 못해 일상이 무너지는 상태로 WHO가 분류한 것은?", "게임 재능", "정상 여가", "게임이용장애", "운동 부족증", 3, "WHO는 게임이용장애를 질병으로 분류했다."],
    ["", "체력", 3, "윗몸말아올리기와 함께 PAPS 근력·근지구력 종목인 것은?", "50m 달리기", "스텝검사", "제자리멀리뛰기", "악력", 4, "근력·근지구력 종목에는 악력·팔굽혀펴기도 있다."],
    ["", "건강", 3, "결핵은 주로 어떤 경로로 전파될까?", "상한 음식을 먹어서", "기침 때 나온 균을 들이마셔서", "피부가 스쳐서", "모기에 물려서", 2, "결핵균은 기침 등으로 공기 중에 퍼진다."],
    ["", "경기규칙", 1, "육상 단거리 경기에서 사용하는 출발 자세는?", "스탠딩 스타트", "크라우칭 스타트", "플라잉 스타트", "롤링 스타트", 2, "단거리는 스타팅 블록을 쓰는 크라우칭 스타트를 한다."],
    ["", "경기규칙", 2, "육상 단거리 출발 신호의 올바른 순서는?", "차려→제자리에→출발 신호", "제자리에→차려→출발 신호", "준비→제자리에→출발 신호", "제자리에→준비→차려", 2, "'제자리에', '차려' 후 출발 신호에 출발한다."],
    ["", "경기규칙", 2, "단거리 달리기에서 결승선 통과를 판정하는 몸의 부위는?", "머리", "앞으로 뻗은 손", "먼저 닿은 발", "몸통(가슴 부분)", 4, "머리·팔·다리가 아닌 몸통이 기준이다."],
    ["", "경기규칙", 3, "계주 경기 중 바통을 떨어뜨렸을 때 규칙으로 옳은 것은?", "떨어뜨린 선수가 주워 이어 간다", "다음 주자가 주워 출발한다", "즉시 실격된다", "심판이 주워 준다", 1, "바통은 떨어뜨린 선수가 직접 주워야 한다."],
    ["", "체육", 2, "허들을 넘을 때 바른 자세로 알맞은 것은?", "상체를 뒤로 젖히고 넘는다", "두 발을 모아 점프한다", "상체를 앞으로 숙이고 넘는다", "허들 위에서 잠시 멈춘다", 3, "상체를 숙여야 낮고 빠르게 넘을 수 있다."],
    ["", "경기규칙", 3, "허들 경기에서 달리다 허들을 쓰러뜨리면?", "무조건 실격된다", "고의가 아니면 실격되지 않는다", "1초가 기록에 더해진다", "다시 세우고 달려야 한다", 2, "일부러 넘어뜨린 경우가 아니면 실격이 아니다."],
    ["", "체육", 1, "멀리뛰기 동작의 올바른 순서는?", "발구르기→도움닫기→공중 동작→착지", "도움닫기→발구르기→공중 동작→착지", "도움닫기→공중 동작→발구르기→착지", "공중 동작→도움닫기→발구르기→착지", 2, "달려와서 구르고, 날고, 착지한다."],
    ["", "경기규칙", 1, "멀리뛰기에서 발구름판의 구름선을 밟고 넘어가면?", "기록에서 10cm를 뺀다", "실패(파울)로 처리된다", "다시 한 번 뛸 수 있다", "그대로 기록을 잰다", 2, "구름선을 넘으면 그 시기는 무효다."],
    ["", "경기규칙", 2, "멀리뛰기 기록은 어디부터 어디까지 잴까?", "구름선~가장 먼 발자국", "출발점~착지한 발끝", "구름선~구름선에 가장 가까운 자국", "발 디딘 곳~엉덩이 자국", 3, "구름선에서 가장 가까운 착지 흔적까지 잰다."],
    ["", "체육", 1, "높이뛰기에서 등을 바 쪽으로 향해 넘는 기술은?", "가위뛰기", "배면뛰기", "벨리롤", "정면뛰기", 2, "배면뛰기(포스베리 플롭)는 등으로 바를 넘는다."],
    ["", "경기규칙", 3, "높이뛰기 발구르기 규칙으로 옳은 것은?", "반드시 두 발로 굴러야 한다", "손을 짚고 넘어도 된다", "반드시 한 발로 굴러야 한다", "도움닫기 없이 뛰어야 한다", 3, "높이뛰기는 한 발 구르기만 허용된다."],
    ["", "경기규칙", 3, "높이뛰기에서 최고 기록이 같을 때 순위를 정하는 기준은?", "그 높이에서 실패가 적은 선수", "키가 작은 선수", "먼저 뛴 선수", "나이가 어린 선수", 1, "동률이면 마지막 성공 높이의 실패 수로 가린다."],
    ["", "체육", 2, "뜀틀 넘기 동작의 올바른 순서는?", "발구르기→도움닫기→손 짚기→착지", "도움닫기→발구르기→손 짚기→착지", "도움닫기→손 짚기→발구르기→착지", "손 짚기→도움닫기→발구르기→착지", 2, "구름판을 구른 뒤 뜀틀을 짚고 착지한다."],
    ["", "체육", 1, "매트에서 앞구르기를 할 때 바른 방법은?", "고개를 들어 이마부터 닿게", "턱을 당겨 뒤통수부터 닿게", "정수리부터 닿게", "팔을 몸 뒤로 뻗는다", 2, "턱을 당겨 몸을 둥글게 말아야 안전하다."],
    ["", "체육", 2, "뒤구르기를 할 때 손의 위치로 알맞은 것은?", "귀 옆에 손바닥을 짚는다", "엉덩이 옆을 짚는다", "무릎을 감싸 쥔다", "허리에 손을 얹는다", 1, "귀 옆을 짚고 밀어야 머리에 부담이 적다."],
    ["", "체육", 2, "옆돌기에서 손과 발이 바닥에 닿는 순서는?", "발→손→손→발", "손→손→발→발", "손→발→손→발", "발→발→손→손", 2, "두 손을 차례로 짚고 두 발이 차례로 내려온다."],
    ["", "경기규칙", 3, "여자 기계체조 경기 종목이 아닌 것은?", "평균대", "이단평행봉", "안마", "도마", 3, "안마는 남자 기계체조 종목이다."],
    ["", "체육", 1, "두 팔을 동시에 돌리고 돌핀킥을 하는 영법은?", "접영", "평영", "배영", "자유형", 1, "접영은 양팔 동시 동작과 돌핀킥을 쓴다."],
    ["", "체육", 1, "'개구리헤엄'이라고도 불리는 영법은?", "평영", "접영", "배영", "자유형", 1, "평영의 발차기가 개구리 다리 동작과 닮았다."],
    ["", "경기규칙", 2, "수영 경기에서 배영의 출발 방법은?", "출발대에서 다이빙", "물 밖에서 서서 출발", "벽 없이 물에 떠서 출발", "물속에서 벽을 잡고 출발", 4, "배영은 물속에서 출발 손잡이를 잡고 출발한다."],
    ["", "경기규칙", 3, "평영과 접영에서 턴·도착 시 벽을 짚는 규칙은?", "한 손으로만 짚는다", "발로 먼저 찬다", "머리가 먼저 닿는다", "두 손으로 동시에 짚는다", 4, "평영·접영은 양손 동시 터치가 규칙이다."],
    ["", "경기규칙", 1, "축구 정규 경기에서 전반·후반 시간은 각각?", "30분", "40분", "45분", "50분", 3, "성인 경기는 전·후반 각 45분이다."],
    ["", "경기규칙", 2, "축구에서 손을 쓸 수 있는 선수는?", "팀의 주장", "모든 수비수", "경기장 어디든 골키퍼", "자기 페널티 구역 안 골키퍼", 4, "골키퍼는 자기 페널티 구역 안에서만 손을 쓴다."],
    ["", "경기규칙", 2, "축구 스로인을 하는 올바른 방법은?", "한 손으로 멀리 던진다", "공을 굴려서 보낸다", "두 손으로 머리 뒤에서 던진다", "발로 차서 넣는다", 3, "두 발을 땅에 대고 두 손으로 머리 위로 던진다."],
    ["", "경기규칙", 3, "축구에서 스로인한 공이 바로 상대 골에 들어가면?", "1점이 인정된다", "페널티킥을 준다", "득점이 인정되지 않는다", "다시 스로인한다", 3, "스로인으로 직접 넣은 골은 득점이 아니다."],
    ["", "경기규칙", 3, "축구에서 오프사이드 반칙이 적용되지 않는 경우는?", "스로인을 바로 받을 때", "스루 패스를 받을 때", "크로스를 받을 때", "프리킥 패스를 받을 때", 1, "스로인·골킥·코너킥은 오프사이드가 없다."],
    ["", "경기규칙", 3, "축구 간접 프리킥이 득점으로 인정되려면?", "차는 즉시 바로 골인", "골키퍼만 닿지 않으면 된다", "다른 선수에게 닿고 골인", "두 번 연속 차서 골인", 3, "간접 프리킥은 다른 선수가 닿아야 득점이다."],
    ["", "경기규칙", 3, "축구 프리킥 때 상대 수비 벽은 공에서 얼마나 떨어져야 할까?", "9.15m", "5m", "7m", "11m", 1, "수비는 공에서 9.15m 이상 떨어져야 한다."],
    ["", "경기규칙", 2, "축구 페널티킥은 골라인에서 몇 m 떨어진 곳에서 찰까?", "11m", "9m", "13m", "16.5m", 1, "페널티 마크는 골라인에서 11m 지점이다."],
    ["", "경기규칙", 2, "축구 승부차기에서 각 팀이 기본으로 차는 횟수는?", "3번", "7번", "5번", "11번", 3, "5번씩 차고 동점이면 1번씩 더 찬다."],
    ["", "체육", 1, "축구에서 짧고 정확한 패스에 주로 쓰는 발 부위는?", "발끝(토)", "발 안쪽(인사이드)", "발뒤꿈치", "발바닥", 2, "발 안쪽은 공과 닿는 면이 넓어 정확하다."],
    ["", "경기규칙", 1, "농구 경기를 시작하는 방법은?", "킥오프", "점프볼", "서브", "페이스오프", 2, "심판이 공을 던져 올리는 점프볼로 시작한다."],
    ["", "경기규칙", 2, "국제 농구 규칙에서 개인 반칙 몇 개면 퇴장할까?", "3개", "4개", "5개", "6개", 3, "FIBA 규칙에서 5반칙이면 퇴장이다."],
    ["", "경기규칙", 3, "농구에서 슛 동작 중 반칙을 당해 2점 슛이 실패하면?", "자유투 1개", "자유투 3개", "공격권만 준다", "자유투 2개", 4, "실패한 슛의 점수만큼 자유투를 준다."],
    ["", "경기규칙", 3, "농구에서 공격팀이 백코트에서 넘어와야 하는 시간은?", "8초 이내", "3초 이내", "5초 이내", "24초 이내", 1, "8초 안에 프런트코트로 넘어와야 한다."],
    ["", "경기규칙", 3, "농구에서 프런트코트로 넘어온 공을 다시 백코트로 가져가면?", "더블 드리블", "트래블링", "백코트 바이얼레이션", "3초 바이얼레이션", 3, "넘어온 공을 다시 뒤로 가져가면 위반이다."],
    ["", "경기규칙", 1, "농구에서 공이 라인 밖으로 나가면 공격권은?", "마지막에 건드린 팀", "무조건 수비팀", "마지막에 안 건드린 팀", "점프볼로 정한다", 3, "마지막에 공을 건드린 팀의 상대가 공을 받는다."],
    ["", "체육", 1, "달려가며 두 걸음 후 한 손으로 올려놓는 슛은?", "점프 슛", "훅 슛", "세트 슛", "레이업 슛", 4, "레이업은 골밑에서 가장 기본적인 슛이다."],
    ["", "체육", 1, "농구에서 바닥에 한 번 튀겨 동료에게 주는 패스는?", "체스트 패스", "바운드 패스", "오버헤드 패스", "야구공 패스", 2, "바닥에 튀겨 수비 손을 피해 보낸다."],
    ["", "체육", 2, "공을 뺏자마자 빠르게 달려가 공격하는 전술은?", "지공", "속공", "지역 방어", "프레스", 2, "속공은 수비가 갖춰지기 전에 공격한다."],
    ["", "체육", 3, "농구에서 몸으로 수비 진로를 막아 동료를 돕는 기술은?", "스크린", "피벗", "스틸", "박스아웃", 1, "스크린은 동료가 수비를 따돌리게 돕는다."],
    ["", "체육", 2, "선수마다 정해진 구역을 맡아 막는 방어 방법은?", "대인 방어", "전면 압박", "속공 방어", "지역 방어", 4, "지역 방어는 사람이 아닌 공간을 맡는다."],
    ["", "체육", 1, "두 팔을 모아 아래팔로 공을 받아 올리는 기술은?", "오버핸드 패스", "스파이크", "언더핸드 패스", "블로킹", 3, "언더핸드 패스는 서브 리시브에 많이 쓴다."],
    ["", "체육", 1, "배구에서 공격수가 때리기 좋게 공을 올려주는 선수는?", "세터", "리베로", "센터", "라이트", 1, "세터는 주로 두 번째 터치로 토스를 한다."],
    ["", "경기규칙", 2, "배구 마지막 5세트는 몇 점을 먼저 내면 이길까?", "11점", "21점", "25점", "15점", 4, "5세트는 15점 랠리포인트로 진행한다."],
    ["", "경기규칙", 2, "서브권을 되찾은 배구 팀의 자리 이동 방향은?", "시계 반대 방향", "시계 방향", "앞뒤로만 이동", "이동하지 않는다", 2, "서브권을 얻으면 시계 방향으로 로테이션한다."],
    ["", "경기규칙", 1, "배구에서 공을 다투다 선수가 네트를 건드리면?", "경기 계속", "다시 서브", "경고만 준다", "반칙(상대 득점)", 4, "플레이 중 네트를 건드리면 반칙이다."],
    ["", "경기규칙", 3, "배구에서 한 선수가 연속 두 번 쳐도 되는 경우는?", "서브 직후", "리시브 직후", "토스 직후", "블로킹 직후", 4, "블로킹 터치는 팀 터치 수에 세지 않는다."],
    ["", "경기규칙", 3, "배구 후위 선수가 반칙이 되는 경우는?", "공격선 앞에서 뛰어 공격", "엔드라인 뒤에서 서브", "후방에서 리시브", "공격선 뒤에서 점프 공격", 1, "후위 선수는 공격선 앞에서 공격할 수 없다."],
    ["", "경기규칙", 3, "배구에서 주심의 서브 휘슬 후 서브 제한 시간은?", "3초", "5초", "8초", "10초", 3, "휘슬 후 8초 안에 서브해야 한다."],
    ["", "체육", 1, "배드민턴에서 높이 뜬 셔틀콕을 강하게 내리치는 기술은?", "클리어", "스매시", "드롭", "드라이브", 2, "스매시는 가장 빠르고 강한 공격 기술이다."],
    ["", "경기규칙", 2, "배드민턴 서브는 어느 쪽으로 보내야 할까?", "정면 서비스 코트", "상대 코트 아무 곳", "대각선 방향 서비스 코트", "네트 바로 앞 어디든", 3, "서브는 대각선 쪽 서비스 코트로 넣는다."],
    ["", "경기규칙", 3, "배드민턴 단식에서 서버 점수가 짝수일 때 서브 위치는?", "왼쪽 서비스 코트", "코트 중앙", "오른쪽 서비스 코트", "원하는 쪽", 3, "짝수(0 포함)는 오른쪽, 홀수는 왼쪽이다."],
    ["", "경기규칙", 3, "배드민턴에서 29:29가 되면?", "2점 차가 날 때까지 계속", "다음 게임으로 넘어감", "무승부로 끝남", "30점을 먼저 내면 승리", 4, "최대 30점이며 29:29면 다음 1점이 승부다."],
    ["", "경기규칙", 2, "탁구 랠리 중 공이 네트에 맞고 상대 코트에 들어가면?", "경기를 계속한다", "바로 실점한다", "다시 서브한다", "상대 득점이다", 1, "서브가 아닌 랠리 중엔 네트 맞아도 유효하다."],
    ["", "경기규칙", 3, "탁구에서 10:10 듀스 이후 서브 교대는?", "1점마다 교대", "2점마다 교대", "5점마다 교대", "교대하지 않는다", 1, "듀스 이후엔 1점마다 서브를 바꾼다."],
    ["", "경기규칙", 1, "핸드볼 경기에서 한 팀이 코트에서 뛰는 선수 수는?", "7명(골키퍼 포함)", "5명", "6명(골키퍼 포함)", "11명", 1, "핸드볼은 골키퍼 포함 7명이 뛴다."],
    ["", "경기규칙", 2, "핸드볼에서 공을 들고 있을 수 있는 최대 시간은?", "5초", "8초", "10초", "3초", 4, "공을 잡고 3초 안에 패스·슛·드리블해야 한다."],
    ["", "경기규칙", 2, "핸드볼 골 에어리어 안에 들어갈 수 있는 선수는?", "공격팀 선수 모두", "수비팀 선수 모두", "공을 가진 선수", "수비팀 골키퍼", 4, "골 에어리어는 골키퍼만 들어갈 수 있다."],
    ["", "경기규칙", 3, "핸드볼에서 7m 던지기가 주어지는 경우는?", "명백한 득점 기회를 반칙으로 막을 때", "공이 사이드라인 밖으로 나갈 때", "골키퍼가 공을 막을 때", "경기 시작할 때", 1, "명백한 득점 기회를 반칙으로 막으면 7m 던지기다."],
    ["", "경기규칙", 1, "야구 정규 경기는 몇 회까지 진행할까?", "5회", "7회", "12회", "9회", 4, "야구 정규 이닝은 9회다."],
    ["", "경기규칙", 1, "야구·티볼에서 주자가 베이스를 도는 방향은?", "1루→2루→3루→홈", "3루→2루→1루→홈", "2루→1루→3루→홈", "홈→3루→2루→1루", 1, "주자는 시계 반대 방향으로 베이스를 돈다."],
    ["", "경기규칙", 3, "야구에서 2스트라이크 후 친 공이 파울이 되면?", "삼진 아웃", "볼 1개 추가", "주자 1루 진루", "스트라이크가 늘지 않는다", 4, "2스트라이크 후 파울은 카운트가 그대로다."],
    ["", "경기규칙", 3, "주자가 반드시 다음 루로 가야 할 때 공을 가진 수비가 그 루를 밟으면?", "태그 아웃", "플라이 아웃", "삼진 아웃", "포스 아웃", 4, "진루 의무가 있으면 루만 밟아도 아웃이다."],
    ["", "경기규칙", 2, "야구공과 소프트볼 공의 크기를 비교하면?", "야구공이 더 크다", "크기가 같다", "정해진 크기가 없다", "소프트볼 공이 더 크다", 4, "소프트볼 공은 야구공보다 크다."],
    ["", "경기규칙", 1, "얼티밋에서 득점하는 방법은?", "골대에 디스크 넣기", "표적에 디스크 맞히기", "상대 엔드존에서 디스크를 잡기", "가장 멀리 던지기", 3, "상대 엔드존 안에서 패스를 받으면 득점이다."],
    ["", "경기규칙", 2, "얼티밋에서 디스크를 가진 선수가 할 수 있는 것은?", "피벗 발 고정 후 방향 바꾸기", "디스크 들고 달리기", "드리블하며 이동", "혼자 던지고 다시 잡기", 1, "디스크를 가지면 피벗만 하고 달릴 수 없다."],
    ["", "경기규칙", 3, "얼티밋에서 디스크를 들고 있을 수 있는 시간은?", "3초", "10초(스톨 카운트)", "5초", "30초", 2, "수비가 10까지 세기 전에 던져야 한다."],
    ["", "체육", 2, "심판 없이 선수 스스로 판정하는 얼티밋의 정신은?", "홈 어드밴티지", "스피릿 오브 더 게임", "노 사이드 정신", "올림픽 휴전", 2, "얼티밋은 스스로 판정하는 경기 정신을 중시한다."],
    ["", "체육", 1, "줄을 한 번 뛸 때 두 번 돌리는 줄넘기 기술은?", "엇걸어 뛰기", "2단 뛰기", "번갈아 뛰기", "모둠발 뛰기", 2, "2단 뛰기는 한 번 점프에 줄을 두 번 돌린다."],
    ["", "체육", 1, "태권도 기본 동작 중 주먹으로 목표를 치는 기술은?", "막기", "차기", "지르기", "서기", 3, "지르기는 주먹으로 공격하는 기본 기술이다."],
    ["", "체육", 2, "태권도 품새에 대한 설명으로 옳은 것은?", "상대와 직접 겨루기", "송판 격파하기", "자유롭게 춤추기", "정해진 순서의 공방 동작 연결", 4, "품새는 정해진 순서로 공격·방어 동작을 잇는다."],
    ["", "체육", 2, "태권도 앞차기에서 목표에 닿는 발 부위는?", "발뒤꿈치", "앞축(발볼)", "발등 옆", "발바닥 전체", 2, "앞차기는 발가락을 젖혀 앞축으로 찬다."],
    ["", "경기규칙", 3, "태권도 겨루기에서 경기를 잠시 멈추는 주심의 구령은?", "시작", "갈려", "계속", "준비", 2, "'갈려'로 멈추고 '계속'으로 다시 시작한다."],
    ["", "올림픽", 3, "태권도가 올림픽 정식 종목이 된 대회는?", "2000년 시드니", "1988년 서울", "1992년 바르셀로나", "2008년 베이징", 1, "서울·바르셀로나에선 시범 종목이었다."],
    ["", "체육", 1, "축구·농구·핸드볼처럼 상대 진영에 들어가 득점하는 유형은?", "네트형", "필드형", "표적형", "영역형", 4, "영역형은 상대 영역을 침범해 득점한다."],
    ["", "체육", 1, "배구·배드민턴·탁구가 속한 경쟁 스포츠 유형은?", "네트형", "영역형", "필드형", "기록형", 1, "네트를 사이에 두고 공을 주고받는다."],
    ["", "체육", 1, "야구·소프트볼·티볼이 속한 스포츠 유형은?", "영역형", "필드형", "네트형", "동작형", 2, "공을 쳐서 베이스를 돌아 득점한다."],
    ["", "체육", 1, "골프·양궁·볼링처럼 목표물을 맞히는 스포츠 유형은?", "기록형", "네트형", "표적형", "동작형", 3, "표적형은 정확성으로 승부한다."],
    ["", "체육", 2, "뜀틀·마루운동처럼 동작의 완성도로 겨루는 유형은?", "기록형", "표적형", "동작형", "영역형", 3, "동작의 정확성과 아름다움을 평가한다."],
    ["", "체육", 2, "영역형 경기에서 공을 갖지 않은 공격수의 좋은 움직임은?", "공 가진 동료 옆에 붙는다", "빈 공간으로 이동한다", "제자리에 서 있는다", "수비수 뒤에 숨는다", 2, "빈 공간으로 움직여야 패스를 받기 쉽다."],
    ["", "체육", 2, "네트형 경기에서 득점에 유리한 공격 전략은?", "상대 정면으로 보내기", "항상 높고 느리게 보내기", "상대가 없는 빈 곳 노리기", "같은 곳만 계속 보내기", 3, "수비가 없는 빈 곳을 노리면 득점하기 쉽다."],
    ["", "올림픽", 1, "고대 올림픽이 시작된 나라는?", "그리스", "이탈리아", "이집트", "프랑스", 1, "고대 올림픽은 그리스 올림피아에서 열렸다."],
    ["", "올림픽", 1, "올림픽 성화를 채화하는 곳은?", "스위스 로잔", "그리스 올림피아", "프랑스 파리", "개최 도시", 2, "성화는 올림피아에서 햇빛으로 채화한다."],
    ["", "올림픽", 2, "제1회 근대 올림픽이 열린 도시는?", "파리(1900년)", "런던(1908년)", "로마(1896년)", "아테네(1896년)", 4, "1896년 아테네에서 첫 근대 올림픽이 열렸다."],
    ["", "올림픽", 2, "올림픽 표어(모토)에 들어가지 않는 말은?", "더 빠르게", "더 높이", "더 힘차게", "더 멀리", 4, "표어는 더 빠르게, 더 높이, 더 힘차게, 다 함께다."],
    ["", "올림픽", 2, "'이기는 것보다 참가하는 데 의의가 있다'는 것은?", "올림픽 신조", "올림픽 헌장 1조", "패럴림픽 표어", "선수 선서", 1, "쿠베르탱이 강조한 올림픽 신조다."],
    ["", "올림픽", 3, "올림픽 개회식에서 가장 먼저 입장하는 나라는?", "개최국", "직전 개최국", "미국", "그리스", 4, "그리스가 맨 먼저, 개최국이 맨 나중에 입장한다."],
    ["", "올림픽", 3, "고대 올림픽 기간에 전쟁을 멈추던 약속은?", "올림픽 휴전", "올림픽 헌장", "올림픽 선서", "올림픽 신조", 1, "휴전 덕분에 선수와 관중이 안전하게 오갔다."],
    ["", "올림픽", 1, "장애가 있는 선수들이 참가하는 국제 종합 대회는?", "유니버시아드", "아시안게임", "유스 올림픽", "패럴림픽", 4, "패럴림픽은 장애인 선수들의 올림픽이다."],
    ["", "올림픽", 1, "패럴림픽은 보통 언제, 어디서 열릴까?", "올림픽 1년 뒤 다른 도시", "올림픽과 같은 날 다른 도시", "올림픽 직후 같은 도시", "월드컵과 함께", 3, "올림픽이 끝난 뒤 같은 도시에서 열린다."],
    ["", "올림픽", 2, "패럴림픽(Paralympic) 이름에 담긴 뜻은?", "올림픽보다 먼저 열리는 대회", "장애인만의 별도 축제", "올림픽과 나란히 열리는 대회", "올림픽을 대신하는 대회", 3, "Parallel(나란히)+Olympic의 뜻을 담았다."],
    ["", "올림픽", 2, "시각장애 육상 선수와 줄로 연결해 함께 달리는 사람은?", "가이드 러너", "페이스메이커", "코치", "도우미 심판", 1, "가이드 러너는 시각장애 선수와 함께 달린다."],
    ["", "올림픽", 3, "시각장애 선수들이 방울 든 공을 굴려 득점하는 종목은?", "골볼", "보치아", "좌식 배구", "휠체어 럭비", 1, "골볼은 소리로 공을 찾는 패럴림픽 종목이다."],
    ["", "올림픽", 3, "중증 장애 선수가 공을 던져 표적 공에 가깝게 붙이는 종목은?", "골볼", "보치아", "컬링", "론볼", 2, "보치아는 표적 공에 가까이 붙이는 경기다."],
    ["", "올림픽", 1, "다음 중 동계 올림픽 종목이 아닌 것은?", "컬링", "스키점프", "조정", "쇼트트랙", 3, "조정은 하계 올림픽 종목이다."],
    ["", "체육", 1, "금지된 약물로 경기력을 높이는 행위는?", "승부조작", "테이핑", "카보로딩", "도핑", 4, "도핑은 공정성과 건강을 해치는 행위다."],
    ["", "체육", 1, "경기 중 상대 선수가 다쳐 쓰러졌을 때 바른 행동은?", "빈틈을 노려 공격한다", "모르는 척 계속한다", "공을 밖으로 내보내 멈춘다", "심판에게 항의한다", 3, "부상 선수 보호가 승리보다 먼저다."],
    ["", "체육", 2, "일부러 경기에 지거나 점수를 조작하는 행위는?", "도핑", "전술적 반칙", "타임아웃", "승부조작", 4, "승부조작은 스포츠의 공정성을 무너뜨린다."],
    ["", "체육", 1, "경기가 끝난 뒤 올바른 태도로 알맞은 것은?", "진 팀을 놀린다", "상대와 악수하며 인사한다", "심판을 탓한다", "바로 자리를 떠난다", 2, "결과와 관계없이 서로를 존중한다."],
    ["", "응급처치", 1, "쓰러진 사람을 발견하면 가장 먼저 할 일은?", "바로 인공호흡하기", "어깨 두드리며 반응 확인", "물을 먹이기", "일으켜 앉히기", 2, "주변 안전과 반응부터 확인해요."],
    ["", "응급처치", 1, "심폐소생술 시 가슴압박 위치는?", "왼쪽 가슴 심장 위", "가슴뼈 아래쪽 절반", "배꼽 바로 위", "목 아래 빗장뼈", 2, "가슴 중앙 가슴뼈의 아래쪽 절반을 눌러요."],
    ["", "응급처치", 1, "119에 신고할 때 가장 먼저 정확히 알려야 할 것은?", "내 학년과 반", "환자의 혈액형", "신고자의 생일", "사고 장소(위치)", 4, "구급차가 오려면 위치가 가장 중요해요."],
    ["", "응급처치", 2, "가슴압박을 할 때 팔의 바른 자세는?", "팔꿈치 펴고 수직으로", "팔꿈치 굽혀 비스듬히", "한 손만 사용", "손가락 끝으로 누르기", 1, "체중을 실어 수직으로 눌러야 해요."],
    ["", "응급처치", 2, "압박 후 가슴이 완전히 올라오게 해야 하는 이유는?", "환자가 숨을 쉬도록", "갈비뼈를 맞추려고", "심장에 피가 다시 차도록", "팔을 쉬게 하려고", 3, "완전히 이완돼야 심장이 다시 채워져요."],
    ["", "응급처치", 3, "인공호흡을 할 때 가슴압박과 인공호흡의 비율은?", "15 : 2", "30 : 2", "30 : 1", "5 : 1", 2, "가슴압박 30회 후 인공호흡 2회를 해요."],
    ["", "응급처치", 2, "인공호흡에 자신이 없는 일반인은 어떻게 할까?", "아무것도 하지 않는다", "가슴압박만 계속한다", "인공호흡만 한다", "구급차를 기다린다", 2, "가슴압박만 해도 생존율을 높일 수 있어요."],
    ["", "응급처치", 3, "심정지 확인을 위한 호흡 관찰은 몇 초 이내로 할까?", "30초 이내", "10초 이내", "1분 이내", "2분 이내", 2, "확인이 길면 가슴압박이 늦어져요."],
    ["", "응급처치", 1, "자동심장충격기(AED)가 도착하면 가장 먼저 할 일은?", "충격 버튼 누르기", "패드 떼어 두기", "전원 켜기", "환자 옷 입히기", 3, "전원을 켜면 음성 안내가 나와요."],
    ["", "응급처치", 2, "AED가 심장 리듬을 분석할 때 해야 할 행동은?", "가슴압박을 계속한다", "환자에게서 손을 뗀다", "환자를 흔든다", "패드를 다시 붙인다", 2, "몸에 닿으면 분석이 정확하지 않아요."],
    ["", "응급처치", 3, "AED로 전기충격을 한 직후 해야 할 일은?", "맥박을 1분간 확인", "AED 전원 끄기", "즉시 가슴압박 다시 시작", "환자를 옆으로 눕히기", 3, "충격 후 바로 가슴압박을 이어 가요."],
    ["", "응급처치", 2, "AED 사용 순서로 옳은 것은?", "전원→패드→분석→충격", "패드→충격→전원→분석", "분석→전원→패드→충격", "전원→충격→패드→분석", 1, "전원을 켜고 패드를 붙인 뒤 안내를 따라요."],
    ["", "응급처치", 1, "심폐소생술은 언제까지 계속해야 할까?", "5분이 지날 때까지", "구급대원이 올 때까지", "100회를 채울 때까지", "팔이 아플 때까지", 2, "구급대 도착이나 환자 회복 때까지 해요."],
    ["", "응급처치", 3, "두 사람이 심폐소생술을 할 때 바람직한 방법은?", "약 10분마다 교대", "약 2분마다 교대", "교대 없이 한 명만", "약 30초마다 교대", 2, "지치면 압박 질이 떨어져 2분마다 바꿔요."],
    ["", "응급처치", 2, "심정지 후 뇌 손상 위험이 커지기 시작하는 시간은?", "약 4분", "약 30초", "약 30분", "약 1시간", 1, "4분 안에 CPR을 시작하는 것이 중요해요."],
    ["", "응급처치", 1, "목을 감싸 쥐며 말을 못 하는 행동이 뜻하는 것은?", "배가 아프다는 신호", "기도가 막혔다는 신호", "목이 마르다는 신호", "열이 난다는 신호", 2, "목을 감싸 쥐는 것은 기도폐쇄 신호예요."],
    ["", "응급처치", 2, "하임리히법에서 주먹을 대는 위치는?", "가슴뼈 한가운데", "배꼽 아래 아랫배", "배꼽과 명치 사이", "등 날개뼈 사이", 3, "배꼽과 명치 사이에 주먹을 대요."],
    ["", "응급처치", 2, "하임리히법에서 주먹을 당기는 방향은?", "안쪽 위로", "아래쪽으로", "옆쪽으로", "바깥쪽 아래로", 1, "복부를 안쪽 위로 당겨 이물을 밀어내요."],
    ["", "응급처치", 1, "음식이 걸렸지만 기침을 세게 할 수 있다면?", "계속 기침하게 한다", "등을 세게 때린다", "물을 마시게 한다", "손가락을 넣어 뺀다", 1, "기침이 가장 효과적인 제거 방법이에요."],
    ["", "응급처치", 3, "기도폐쇄 환자가 의식을 잃고 쓰러지면?", "하임리히법을 계속", "물을 먹인다", "옆으로 눕혀 기다린다", "119 신고 후 CPR 시작", 4, "의식이 없으면 바로 심폐소생술을 해요."],
    ["", "응급처치", 3, "1세 미만 영아의 기도폐쇄 처치로 알맞은 것은?", "복부 밀어 올리기", "거꾸로 들고 흔들기", "손가락으로 입속 훑기", "등 두드리기·가슴 밀기", 4, "영아는 등 두드리기와 가슴 밀기를 해요."],
    ["", "응급처치", 1, "피가 나는 상처에 가장 먼저 할 처치는?", "알코올을 부어 닦기", "상처를 입으로 빨기", "깨끗한 거즈로 직접 압박", "휴지로 세게 문지르기", 3, "출혈은 직접 압박으로 멈춰요."],
    ["", "응급처치", 2, "압박하던 거즈가 피에 흠뻑 젖으면?", "거즈를 떼고 새로 댄다", "압박을 멈춘다", "물로 씻어 낸다", "그 위에 거즈를 덧댄다", 4, "떼면 굳던 피가 떨어져 다시 피가 나요."],
    ["", "응급처치", 1, "화상으로 생긴 물집은 어떻게 할까?", "바늘로 터뜨린다", "손으로 짠다", "터뜨리지 않는다", "껍질을 벗긴다", 3, "물집이 터지면 감염 위험이 커져요."],
    ["", "응급처치", 2, "화상 부위를 흐르는 물로 식히는 시간은?", "10초 정도", "1~2분 정도", "10~20분 정도", "2시간 이상", 3, "시원한 물로 10~20분 식혀요."],
    ["", "응급처치", 1, "RICE 처치에서 E가 뜻하는 것은?", "다친 부위 올리기", "운동하기", "전기 치료", "관절 펴기", 1, "E는 거상, 심장보다 높게 올려요."],
    ["", "응급처치", 2, "발목을 삐었을 때 얼음찜질 방법은?", "맨살에 1시간 이상", "얼음으로 세게 문지르기", "수건에 싸서 15~20분", "뜨거운 찜질 30분", 3, "얼음은 감싸서 15~20분씩 대요."],
    ["", "응급처치", 2, "삔 직후(48시간 이내) 피해야 할 것은?", "뜨거운 찜질", "얼음찜질", "붕대로 압박", "다리 올리기", 1, "초기 온찜질은 붓기를 키울 수 있어요."],
    ["", "응급처치", 3, "골절 부위에 부목을 댈 때 고정 범위는?", "위아래 관절까지", "다친 곳만 좁게", "손가락 끝까지만", "온몸 전체", 1, "위아래 관절까지 고정해야 움직이지 않아요."],
    ["", "응급처치", 2, "코피가 날 때 손으로 누르는 부위는?", "콧등의 단단한 뼈", "양쪽 눈썹 사이", "코의 부드러운 아래쪽", "목 뒤쪽", 3, "콧방울 부분을 양쪽에서 눌러요."],
    ["", "응급처치", 3, "코피를 멈추려면 코를 약 얼마 동안 눌러야 할까?", "약 10초", "약 10분", "약 1분", "약 1시간", 2, "10분 정도 계속 눌러야 피가 멈춰요."],
    ["", "응급처치", 3, "열사병 환자에게 하면 안 되는 것은?", "그늘로 옮기기", "의식 없을 때 물 먹이기", "옷 느슨히 하기", "119 신고하기", 2, "의식이 없으면 기도가 막힐 수 있어요."],
    ["", "응급처치", 3, "땀을 많이 흘리고 피부가 차고 축축하며 어지럽다면?", "열사병", "저체온증", "열탈진", "동상", 3, "열탈진은 땀이 많고 피부가 서늘해요."],
    ["", "응급처치", 1, "저체온증 환자에게 알맞은 처치는?", "찬물로 씻기기", "팔다리 세게 문지르기", "차가운 음료 먹이기", "젖은 옷 벗기고 담요 덮기", 4, "몸을 마르게 하고 따뜻하게 감싸요."],
    ["", "응급처치", 3, "저체온증은 체온이 몇 ℃ 이하일 때를 말할까?", "35℃", "37℃", "36.5℃", "38℃", 1, "중심 체온 35℃ 이하를 저체온증이라 해요."],
    ["", "응급처치", 2, "운동 중 머리를 부딪친 뒤 어지럽고 메스껍다면?", "물 마시고 바로 경기", "혼자 집에 걸어가기", "운동을 멈추고 진료받기", "더 뛰어서 정신 차리기", 3, "뇌진탕일 수 있어 즉시 멈춰야 해요."],
    ["", "응급처치", 3, "의식은 없지만 숨은 정상인 환자의 자세는?", "엎드린 자세", "앉힌 자세", "옆으로 눕힌 회복 자세", "똑바로 눕혀 머리 들기", 3, "구토물로 기도가 막히지 않게 해요."],
    ["", "안전", 1, "자전거를 타고 횡단보도를 건널 때 바른 방법은?", "빠르게 타고 건넌다", "한 손으로 타고 건넌다", "친구와 나란히 탄다", "내려서 끌고 건넌다", 4, "횡단보도에서는 내려서 끌고 가요."],
    ["", "안전", 2, "자전거 도로가 없을 때 자전거가 다닐 곳은?", "도로 왼쪽 가장자리", "도로 오른쪽 가장자리", "도로 한가운데", "중앙선 가까이", 2, "차도의 오른쪽 가장자리로 다녀요."],
    ["", "안전", 1, "화재 때 연기를 피해 대피하는 자세는?", "똑바로 서서 뛰기", "낮은 자세로 코·입 막기", "숨을 크게 쉬며 걷기", "눈을 감고 기어가기", 2, "연기는 위로 올라가 낮은 곳이 안전해요."],
    ["", "안전", 1, "화재 대피 때 이용하면 안 되는 것은?", "엘리베이터", "계단", "비상구", "피난 유도등 방향", 1, "정전되면 엘리베이터에 갇힐 수 있어요."],
    ["", "안전", 2, "옷에 불이 붙었을 때 바른 행동은?", "바람 쪽으로 달리기", "손으로 계속 털기", "옷을 세게 흔들기", "멈추고 엎드려 구르기", 4, "달리면 산소가 공급돼 불이 커져요."],
    ["", "안전", 3, "소화기 사용 순서로 옳은 것은?", "손잡이→안전핀→노즐 조준", "노즐 조준→손잡이→안전핀", "안전핀→노즐 조준→손잡이", "손잡이→노즐 조준→안전핀", 3, "핀을 뽑고 불을 향해 손잡이를 눌러요."],
    ["", "안전", 1, "교실에서 지진으로 흔들릴 때 먼저 할 행동은?", "책상 아래서 머리 보호", "바로 밖으로 뛰기", "창문 옆에 서기", "엘리베이터로 대피", 1, "흔들릴 땐 몸을 낮추고 머리를 보호해요."],
    ["", "안전", 2, "지진의 흔들림이 멈춘 뒤 대피할 장소는?", "건물 바로 옆", "좁은 골목", "지하 주차장", "운동장 같은 넓은 곳", 4, "떨어지는 물건이 없는 넓은 곳이 안전해요."],
    ["", "안전", 3, "지진 때 건물 밖에 있다면 피해야 할 곳은?", "넓은 공원", "유리창·간판 아래", "학교 운동장", "트인 공터", 2, "유리나 간판이 떨어질 수 있어요."],
    ["", "안전", 1, "물놀이 전에 꼭 해야 할 것은?", "음식 많이 먹기", "혼자 깊은 곳 가기", "물에 바로 뛰어들기", "준비운동하기", 4, "갑자기 찬물에 들어가면 위험해요."],
    ["", "안전", 3, "바다에서 이안류에 휩쓸렸을 때 바른 대처는?", "해안 쪽으로 곧장 헤엄", "바다 쪽으로 헤엄", "제자리에서 발버둥", "해안과 나란히 헤엄친다", 4, "이안류는 폭이 좁아 옆으로 벗어나요."],
    ["", "안전", 1, "횡단보도 초록불이 깜빡일 때 바른 행동은?", "다음 신호를 기다린다", "뛰어서 건넌다", "천천히 걸어 건넌다", "차를 보며 건넌다", 1, "곧 빨간불로 바뀌니 기다려요."],
    ["", "안전", 2, "주차된 차 사이로 길을 건너면 위험한 이유는?", "차 소리가 커서", "신호가 바뀌어서", "운전자가 나를 못 봐서", "도로가 미끄러워서", 3, "차에 가려 운전자 시야에서 안 보여요."],
    ["", "안전", 1, "화재·구급 상황의 신고 번호는?", "112", "119", "114", "110", 2, "119는 화재와 응급 환자 신고 번호예요."],
    ["", "안전", 3, "중학교 1학년이 전동킥보드를 타는 것은?", "헬멧만 쓰면 된다", "인도에서는 괜찮다", "면허가 없어 불법이다", "부모 허락 시 가능", 3, "원동기 면허(만 16세 이상)가 필요해요."],
    ["", "운동과학", 1, "운동을 시작하면 심박수는 어떻게 될까?", "느려진다", "변화 없다", "빨라진다", "잠깐 멈춘다", 3, "근육에 혈액을 더 보내려고 빨라져요."],
    ["", "운동과학", 1, "운동할 때 땀을 흘리는 주된 이유는?", "근육을 키우려고", "혈액을 늘리려고", "뼈를 튼튼히 하려고", "체온을 낮추려고", 4, "땀으로 몸의 열을 내보내요."],
    ["", "운동과학", 1, "운동 중 숨이 가빠지는 이유는?", "근육에 산소가 더 필요해서", "폐가 작아져서", "혈액이 줄어서", "체온이 내려가서", 1, "산소를 더 들이마시려고 호흡이 빨라져요."],
    ["", "운동과학", 1, "맥박을 재기 좋은 곳은?", "손목 엄지 쪽", "팔꿈치 바깥쪽", "무릎 앞쪽", "발바닥 가운데", 1, "손목 엄지 쪽이나 목 옆에서 재요."],
    ["", "운동과학", 2, "15초 동안 맥박이 25회 뛰었다면 1분 심박수는?", "100회", "75회", "125회", "40회", 1, "15초 맥박에 4를 곱해요."],
    ["", "운동과학", 3, "운동을 멈춘 뒤에도 한동안 숨이 찬 이유는?", "폐가 다쳐서", "근육이 계속 수축해서", "체온이 낮아져서", "부족했던 산소를 보충하려고", 4, "운동 중 진 산소 빚을 갚는 과정이에요."],
    ["", "운동과학", 1, "근육과 뼈를 이어 주는 것은?", "인대", "연골", "신경", "힘줄(건)", 4, "힘줄이 근육의 힘을 뼈에 전해요."],
    ["", "운동과학", 2, "뼈와 뼈를 이어 관절을 붙잡아 주는 것은?", "인대", "힘줄", "근육", "혈관", 1, "인대가 관절을 안정시켜요."],
    ["", "운동과학", 2, "관절에서 뼈끝을 덮어 충격을 줄이는 것은?", "인대", "힘줄", "골수", "연골", 4, "연골이 뼈끼리 부딪치는 것을 막아요."],
    ["", "운동과학", 2, "뼈의 역할이 아닌 것은?", "음식 소화", "몸을 지탱", "내장 보호", "혈액 세포 생성", 1, "소화는 소화 기관이 담당해요."],
    ["", "운동과학", 1, "성인의 뼈는 약 몇 개일까?", "약 106개", "약 306개", "약 600개", "약 206개", 4, "성인의 뼈는 약 206개예요."],
    ["", "운동과학", 2, "뼈의 길이 성장이 일어나는 곳은?", "골수", "인대", "관절낭", "성장판", 4, "뼈끝의 성장판에서 키가 자라요."],
    ["", "운동과학", 2, "팔꿈치를 굽힐 때 주로 수축하는 근육은?", "위팔세갈래근", "넙다리네갈래근", "장딴지근", "위팔두갈래근", 4, "이두근이 수축하면 팔이 굽어요."],
    ["", "운동과학", 3, "한쪽 근육이 수축할 때 반대쪽이 이완하는 관계는?", "협동 작용", "반사 작용", "길항 작용", "대사 작용", 3, "이두근과 삼두근이 대표적 길항근이에요."],
    ["", "운동과학", 3, "심장근의 특징으로 알맞은 것은?", "쉬지 않고 스스로 움직임", "내 마음대로 움직임", "뼈에 붙어 있음", "운동할 때만 움직임", 1, "심장근은 의지와 상관없이 뛰어요."],
    ["", "운동과학", 3, "무릎처럼 한 방향으로만 굽혀지는 관절은?", "절구 관절", "경첩 관절", "중쇠 관절", "평면 관절", 2, "문 경첩처럼 한 방향으로 움직여요."],
    ["", "운동과학", 1, "오래 달리기처럼 산소를 쓰며 오래 하는 운동은?", "무산소 운동", "유산소 운동", "순발력 운동", "정적 운동", 2, "산소로 에너지를 만들며 오래 해요."],
    ["", "운동과학", 2, "무산소 운동의 예로 알맞은 것은?", "30분 걷기", "100m 전력 달리기", "1시간 자전거 타기", "천천히 오래 수영", 2, "짧고 강한 운동은 무산소 운동이에요."],
    ["", "운동과학", 3, "지방 1g이 내는 에너지는 약 몇 kcal?", "4kcal", "7kcal", "9kcal", "1kcal", 3, "지방은 1g당 약 9kcal를 내요."],
    ["", "운동과학", 1, "먹는 에너지보다 쓰는 에너지가 많으면?", "체중이 늘어난다", "변화가 없다", "키가 큰다", "체중이 줄어든다", 4, "부족한 에너지를 몸에 저장된 것으로 써요."],
    ["", "운동과학", 3, "가만히 있어도 생명 유지에 쓰이는 에너지는?", "활동대사량", "기초대사량", "운동 소비량", "소화 흡수량", 2, "숨쉬기·체온 유지 등에 쓰는 에너지예요."],
    ["", "운동과학", 1, "운동 중 물 마시는 방법으로 알맞은 것은?", "끝난 뒤 한꺼번에", "조금씩 자주 마신다", "목마를 때까지 참기", "탄산음료로만 마시기", 2, "조금씩 자주 마셔야 탈수를 막아요."],
    ["", "운동과학", 3, "피로에 강해 지구력 운동에 유리한 근섬유는?", "지근(적색근)", "속근(백색근)", "평활근", "심장근", 1, "지근은 산소를 써서 오래 버텨요."],
    ["", "운동과학", 3, "근육 길이 변화 없이 힘을 주는 운동은?", "팔굽혀펴기", "스쿼트", "줄넘기", "벽 밀기", 4, "등척성 운동은 관절이 움직이지 않아요."],
    ["", "운동과학", 2, "정적 스트레칭은 한 자세를 약 몇 초 유지할까?", "15~30초", "1~2초", "3~5분", "10분 이상", 1, "15~30초 정도 천천히 유지해요."],
    ["", "운동과학", 1, "스트레칭의 바른 강도는?", "아플 때까지 세게", "약간 당기는 느낌까지", "관절 소리가 날 때까지", "친구가 세게 눌러 줄 때까지", 2, "통증 없는 범위에서 해야 안전해요."],
    ["", "운동과학", 2, "준비운동의 바른 순서는?", "종목 동작→체조→가벼운 뛰기", "체조→본 경기→가벼운 뛰기", "가벼운 뛰기→체조→종목 동작", "전력 질주→체조→걷기", 3, "몸을 데운 뒤 종목 동작으로 넘어가요."],
    ["", "운동과학", 1, "정리운동으로 알맞은 활동은?", "전력 질주", "높이뛰기 연습", "가볍게 걷기", "무거운 역기 들기", 3, "강도를 서서히 낮추는 활동이 좋아요."],
    ["", "운동과학", 2, "동적 스트레칭의 예로 알맞은 것은?", "앉아 다리 잡고 30초", "걸으며 다리 앞으로 차기", "벽 짚고 종아리 늘여 유지", "누워 무릎 안고 유지", 2, "움직이며 관절 범위를 늘려요."],
    ["", "안전", 1, "스포츠 손상 예방 방법으로 알맞지 않은 것은?", "알맞은 보호 장비 착용", "충분한 휴식", "아파도 참고 계속하기", "경기 규칙 지키기", 3, "통증은 몸이 보내는 경고 신호예요."],
    ["", "안전", 3, "같은 동작을 지나치게 반복해 생기는 손상은?", "과사용 손상", "급성 손상", "충돌 손상", "열 손상", 1, "무리한 반복으로 조금씩 손상이 쌓여요."],
    ["", "표현", 1, "표현 활동의 움직임 요소가 아닌 것은?", "공간", "점수", "노력", "관계", 2, "움직임 요소는 신체·공간·노력·관계예요."],
    ["", "표현", 2, "높게·중간·낮게 움직이는 것은 어느 요소일까?", "노력(힘)", "관계", "신체(부위)", "공간(수준)", 4, "높낮이는 공간 요소의 수준이에요."],
    ["", "표현", 2, "빠르게·느리게, 강하게·약하게는 어느 요소일까?", "공간", "관계", "신체", "노력", 4, "시간·힘·흐름은 노력 요소예요."],
    ["", "표현", 2, "짝의 동작을 거울처럼 따라 하는 것은 어느 요소?", "관계", "공간", "노력", "신체", 1, "다른 사람과의 관계를 표현해요."],
    ["", "표현", 2, "직선·곡선·지그재그로 이동하는 것은?", "수준", "흐름", "힘", "경로", 4, "이동하는 길의 모양을 경로라 해요."],
    ["", "표현", 3, "같은 동작을 시간차를 두고 차례로 하는 구성은?", "캐논(돌림)", "유니즌", "미러링", "즉흥", 1, "돌림노래처럼 차례로 이어 해요."],
    ["", "표현", 1, "강강술래는 주로 어떤 대형으로 할까?", "일렬 종대", "두 줄 마주 보기", "흩어져 혼자", "손잡고 둥근 원", 4, "손을 잡고 원을 그리며 돌아요."],
    ["", "표현", 2, "강강술래를 주로 하던 때는?", "설날 아침", "단오 낮", "추석·정월 대보름 밤", "동지 새벽", 3, "보름달이 뜬 밤에 놀았어요."],
    ["", "표현", 3, "강강술래가 전해 온 대표 지역은?", "강원도 산간", "경상북도 내륙", "전라남도 해안", "함경도 북부", 3, "전라남도 남해안에서 전해 왔어요."],
    ["", "표현", 1, "탈춤의 특징으로 알맞은 것은?", "탈 쓰고 풍자·해학", "공을 다루는 춤", "얼음 위에서 추는 춤", "말없이 혼자 추는 춤", 1, "탈을 쓰고 사회를 풍자했어요."],
    ["", "표현", 3, "안동에서 전해 오는 탈놀이는?", "하회별신굿탈놀이", "봉산탈춤", "북청사자놀음", "강령탈춤", 1, "하회마을에서 전해 오는 탈놀이예요."],
    ["", "표현", 2, "왈츠 음악의 박자는?", "2/4박자", "3/4박자", "4/4박자", "6/8박자", 2, "쿵짝짝 3박자에 맞춰 춰요."],
    ["", "표현", 1, "브레이킹(브레이크댄스)이 속한 장르는?", "발레", "라틴 댄스", "힙합 댄스", "민속무용", 3, "거리 문화에서 생긴 힙합 춤이에요."],
    ["", "표현", 2, "차차차·룸바·삼바가 속한 댄스는?", "모던 댄스", "힙합 댄스", "민속무용", "라틴 댄스", 4, "스포츠댄스 중 라틴 종목이에요."],
    ["", "표현", 3, "굿거리장단은 한 장단이 몇 박일까?", "2박", "3박", "4박", "6박", 3, "굿거리는 세 소박씩 묶인 4박이에요."],
    ["", "표현", 1, "표현 작품 만들기의 첫 단계는?", "발표하기", "감상하기", "의상 고르기", "주제 정하기", 4, "무엇을 표현할지 먼저 정해요."],
    ["", "표현", 3, "물 흐르듯 끊김 없이 움직이는 것은 노력 요소 중?", "시간", "흐름", "힘", "방향", 2, "흐름은 이어지거나 끊기는 정도예요."]
  ];
}

/* ------------------------------------------------------------
 *  예시 데이터
 * ------------------------------------------------------------ */
function sampleQuizzes() {
  // [학년, 분야, 난이도, 문제, 보기1, 보기2, 보기3, 보기4, 정답번호, 해설]
  return [
    ['', '체육', 1, '운동 전에 준비운동을 하는 가장 큰 이유는?', '부상을 예방하려고', '배가 고파서', '친구를 기다리려고', '옷을 갈아입으려고', 1, '근육과 관절을 풀어 부상을 막아요.'],
    ['', '체육', 1, '농구에서 공을 들고 세 걸음 이상 걸으면?', '트래블링', '파울', '홈런', '오프사이드', 1, '트래블링 반칙이에요.'],
    ['', '체육', 2, '배구 한 팀이 상대 코트로 공을 넘기기 전까지 최대 몇 번 칠 수 있을까?', '3번', '2번', '4번', '5번', 1, '블로킹을 제외하고 3번 안에 넘겨야 해요.'],
    ['', '체육', 1, '줄넘기를 할 때 착지는 발의 어느 부분으로 하는 게 좋을까?', '발 앞꿈치', '발뒤꿈치', '발바닥 전체를 쿵', '발 옆면', 1, '앞꿈치로 가볍게 착지하면 충격이 줄어요.'],
    ['', '체육', 2, '오래달리기로 주로 기를 수 있는 체력 요소는?', '심폐지구력', '유연성', '순발력', '평형성', 1, '심장과 폐의 능력이 좋아져요.'],
    ['', '체육', 2, '윗몸 앞으로 굽히기로 측정하는 체력 요소는?', '유연성', '근력', '민첩성', '심폐지구력', 1, '몸이 얼마나 잘 구부러지는지 재요.'],
    ['', '체육', 2, '50m 달리기로 주로 측정하는 체력 요소는?', '순발력(스피드)', '유연성', '근지구력', '평형성', 1, '짧은 시간 빠르게 움직이는 능력이에요.'],
    ['', '체육', 3, '팔굽혀펴기를 여러 번 반복하는 능력은 어떤 체력 요소일까?', '근지구력', '순발력', '유연성', '협응성', 1, '근육이 오래 버티는 힘이에요.'],
    ['', '체육', 2, '육상 이어달리기에서 다음 주자에게 넘겨주는 막대는?', '배턴', '라켓', '스틱', '큐', 1, ''],
    ['', '체육', 3, '축구에서 공보다 앞쪽, 마지막 수비수보다 앞에서 패스를 받으면?', '오프사이드', '핸드볼', '코너킥', '스로인', 1, ''],
    ['', '체육', 2, '태권도는 어느 나라에서 시작된 운동일까?', '대한민국', '일본', '중국', '브라질', 1, ''],
    ['', '건강', 1, '손 씻기는 최소 몇 초 이상 하는 것이 좋을까?', '30초', '3초', '5초', '1초', 1, '비누로 30초 이상 꼼꼼히!'],
    ['', '건강', 1, '청소년에게 권장되는 하루 수면 시간은?', '8~10시간', '3~4시간', '5시간', '15시간 이상', 1, '성장기에는 충분한 잠이 필요해요.'],
    ['', '건강', 1, '운동 중 물은 어떻게 마시는 게 좋을까?', '조금씩 자주', '한 번에 2리터', '절대 마시지 않기', '탄산음료만', 1, ''],
    ['', '건강', 2, '우리 몸에 에너지를 주는 대표 영양소가 아닌 것은?', '비타민', '탄수화물', '지방', '단백질', 1, '비타민은 몸의 기능을 조절해요.'],
    ['', '건강', 2, '근육을 만드는 데 가장 중요한 영양소는?', '단백질', '설탕', '소금', '카페인', 1, ''],
    ['', '건강', 2, '스마트폰을 오래 볼 때 생기기 쉬운 문제는?', '거북목과 눈의 피로', '키가 갑자기 큼', '감기가 낫는다', '근력이 세진다', 1, ''],
    ['', '건강', 2, '양치질은 하루에 몇 번, 언제 하는 것이 좋을까?', '하루 3번, 식후 3분 이내 3분 동안', '하루 1번 아무 때나', '일주일에 1번', '배고플 때만', 1, '3·3·3 법칙!'],
    ['', '건강', 3, '열사병이 의심되는 친구에게 먼저 해야 할 일은?', '그늘로 옮기고 몸을 식힌다', '더 뛰게 한다', '뜨거운 물을 준다', '혼자 둔다', 1, '시원한 곳으로 옮기고 어른께 알려요.'],
    ['', '건강', 2, '골고루 먹어야 하는 이유는?', '여러 영양소를 얻기 위해', '배를 빨리 채우려고', '맛이 없어서', '살을 찌우려고', 1, ''],
    ['', '안전', 2, '코피가 날 때 올바른 자세는?', '고개를 약간 숙이고 콧볼을 누른다', '고개를 뒤로 젖힌다', '누워서 위를 본다', '뛰어다닌다', 1, '고개를 젖히면 피가 목으로 넘어가요.'],
    ['', '안전', 2, '발목을 삐었을 때 처치로 알맞은 것은?', '쉬고 얼음찜질 하기', '뜨거운 찜질 바로 하기', '계속 달리기', '세게 주무르기', 1, '휴식·냉찜질·압박·높이 올리기!'],
    ['', '안전', 3, '심폐소생술에서 가슴 압박은 1분에 약 몇 회 속도로 할까?', '100~120회', '10~20회', '200~250회', '50회', 1, ''],
    ['', '건강', 2, '하루에 권장되는 신체활동 시간(청소년)은?', '60분 이상', '5분', '하지 않아도 됨', '10시간', 1, 'WHO는 하루 평균 60분 이상의 중고강도 활동을 권장해요.'],
    ['', '건강', 3, '운동 후 정리운동을 하면 좋은 점은?', '피로 회복과 근육통 감소', '배가 더 고파진다', '키가 줄어든다', '효과 없음', 1, ''],
    ['', '체육', 3, '올림픽 오륜기의 고리는 몇 개일까?', '5개', '4개', '6개', '7개', 1, '다섯 대륙을 뜻해요.'],
    ['', '건강', 1, '당분이 많은 음료를 많이 마시면?', '충치와 비만 위험이 커진다', '이가 튼튼해진다', '키가 큰다', '시력이 좋아진다', 1, ''],
    ['', '체육', 2, '탁구공의 색으로 공식 경기에서 쓰는 것은?', '흰색 또는 주황색', '검은색', '빨간색', '초록색', 1, ''],
    ['', '건강', 2, '바른 자세로 앉는 방법은?', '허리를 펴고 엉덩이를 의자 깊숙이', '다리를 꼬고 앉기', '등을 구부리기', '한쪽으로 기울기', 1, ''],
    ['', '체육', 2, '농구에서 3점 슛 라인 밖에서 넣은 슛은 몇 점?', '3점', '2점', '1점', '4점', 1, ''],
    // ---------- 중학교 수준 추가 문항 (난이도 2~3) ----------
    // 체력·운동생리
    ['', '체육', 2, '건강 관련 체력 요소가 아닌 것은?', '민첩성', '심폐지구력', '근력', '유연성', 1, '민첩성·순발력·평형성·협응성은 운동 기능 관련 체력이에요.'],
    ['', '체육', 2, '운동 기능 관련 체력 요소에 해당하는 것은?', '평형성', '근지구력', '심폐지구력', '신체 조성', 1, '평형성·민첩성·순발력·협응성·스피드·반응시간이 운동 기능 관련 체력이에요.'],
    ['', '체육', 3, '체지방률처럼 몸을 구성하는 성분의 비율을 뜻하는 체력 요소는?', '신체 조성', '근지구력', '유연성', '순발력', 1, ''],
    ['', '체육', 2, '다음 중 유산소 운동에 가장 가까운 것은?', '30분 조깅', '100m 전력 질주', '역기 1회 최대 들기', '제자리 높이뛰기', 1, '오래 지속하며 산소를 이용해 에너지를 내는 운동이 유산소 운동이에요.'],
    ['', '체육', 3, '최대 심박수를 어림하는 공식으로 알맞은 것은?', '220 − 나이', '200 − 나이', '220 + 나이', '나이 × 2', 1, '14세라면 약 206회/분이 최대 심박수예요.'],
    ['', '체육', 3, '운동 강도를 정할 때 쓰는 "목표 심박수"는 보통 최대 심박수의 몇 % 범위일까?', '약 60~85%', '약 10~20%', '100% 이상', '약 30~40%', 1, ''],
    ['', '체육', 3, '운동 처방의 FITT 원리에서 T 두 개는 무엇을 뜻할까?', '시간(Time)과 형태(Type)', '팀(Team)과 시험(Test)', '시간(Time)과 목표(Target)', '횟수(Times)와 피로(Tired)', 1, 'F=빈도, I=강도, T=시간, T=형태(종류)'],
    ['', '체육', 2, '운동을 꾸준히 하면 안정 시 심박수는 어떻게 될까?', '낮아진다', '높아진다', '변화 없다', '불규칙해진다', 1, '심장이 튼튼해져 한 번에 더 많은 피를 보내기 때문이에요.'],
    ['', '체육', 3, '근육이 커지고 힘이 세지는 훈련의 원리 중, 평소보다 더 큰 부하를 주어야 한다는 원리는?', '과부하의 원리', '가역성의 원리', '개별성의 원리', '특이성의 원리', 1, ''],
    ['', '체육', 3, '운동을 그만두면 체력이 다시 원래대로 돌아간다는 훈련 원리는?', '가역성의 원리', '과부하의 원리', '점진성의 원리', '반복성의 원리', 1, ''],
    ['', '체육', 2, '격렬한 운동 뒤 근육에 쌓여 피로감을 주는 물질은?', '젖산', '포도당', '칼슘', '헤모글로빈', 1, ''],
    ['', '체육', 3, '순간적으로 큰 힘을 내는 능력(제자리멀리뛰기 등)을 무엇이라 할까?', '순발력', '근지구력', '심폐지구력', '유연성', 1, ''],
    ['', '체육', 2, '왕복 오래달리기(셔틀런)로 측정하는 체력 요소는?', '심폐지구력', '유연성', '순발력', '평형성', 1, ''],
    ['', '체육', 3, '운동 후 정리운동(쿨다운)의 효과로 알맞지 않은 것은?', '근육량을 즉시 늘린다', '심박수를 서서히 낮춘다', '젖산 제거를 돕는다', '어지럼증을 예방한다', 1, ''],
    ['', '체육', 3, '준비운동으로 더 적합한 스트레칭 방식은?', '동적 스트레칭', '정적 스트레칭', '반동 스트레칭', '스트레칭 생략', 1, '운동 전에는 움직이며 하는 동적 스트레칭, 운동 후에는 정적 스트레칭이 좋아요.'],
    // 종목 규칙 — 탁구
    ['', '체육', 2, '탁구 공식 경기에서 한 게임은 몇 점을 먼저 얻으면 이길까?', '11점', '21점', '15점', '7점', 1, '2점 차가 나야 해요. 10:10이면 듀스.'],
    ['', '체육', 2, '탁구에서 서브는 몇 점마다 교대할까?', '2점', '1점', '5점', '게임이 끝날 때', 1, '10:10 듀스 이후에는 1점마다 교대해요.'],
    ['', '체육', 3, '탁구 서브 규칙으로 옳은 것은?', '공을 손바닥에서 16cm 이상 수직으로 띄워야 한다', '공을 탁자 아래에서 던져 올린다', '라켓으로 공을 튕겨 서브한다', '공을 가린 채 서브해도 된다', 1, ''],
    ['', '체육', 2, '탁구에서 서브한 공이 네트에 닿고 상대 코트에 들어가면?', '렛(Let), 다시 서브', '서브한 쪽 득점', '받는 쪽 득점', '그대로 경기 진행', 1, ''],
    ['', '체육', 3, '탁구 공의 공식 지름은?', '40mm', '38mm', '45mm', '50mm', 1, '2000년부터 38mm에서 40mm로 커졌어요.'],
    ['', '체육', 3, '탁구 복식 경기에서 서브는 어디로 넣어야 할까?', '자기 오른쪽 코트에서 상대 오른쪽 코트로 대각선', '아무 곳이나', '정면으로 똑바로', '왼쪽에서 왼쪽으로', 1, ''],
    ['', '체육', 2, '탁구에서 공에 역회전을 걸어 낮게 깔리게 치는 수비 기술은?', '커트(푸시)', '스매시', '드라이브', '서브', 1, ''],
    ['', '체육', 3, '탁구에서 공이 자기 코트에서 두 번 튀긴 뒤 치면?', '상대 득점', '자기 득점', '렛', '경고', 1, ''],
    ['', '체육', 3, '탁구 경기에서 라켓을 쥐는 방법 중 펜을 잡듯 쥐는 그립은?', '펜홀더 그립', '셰이크핸드 그립', '웨스턴 그립', '이스턴 그립', 1, ''],
    // 종목 규칙 — 구기
    ['', '체육', 2, '농구에서 공을 두 손으로 잡았다가 다시 드리블하면?', '더블 드리블', '트래블링', '차징', '골텐딩', 1, ''],
    ['', '체육', 3, '농구에서 공격팀이 공을 잡은 뒤 슛을 해야 하는 제한 시간은?', '24초', '8초', '30초', '60초', 1, ''],
    ['', '체육', 3, '농구에서 공격 제한 구역(페인트 존) 안에 공격수가 3초 넘게 머물면?', '3초 룰 위반', '5초 룰 위반', '24초 룰 위반', '정상 플레이', 1, ''],
    ['', '체육', 2, '배구 경기에서 한 팀의 코트 위 선수 수는?', '6명', '5명', '7명', '11명', 1, ''],
    ['', '체육', 3, '배구에서 수비 전문 선수로, 다른 색 유니폼을 입는 포지션은?', '리베로', '세터', '센터', '레프트', 1, ''],
    ['', '체육', 3, '배구에서 25점을 먼저 얻어도 승리가 아닌 경우는?', '점수 차가 1점일 때', '서브를 넣지 않았을 때', '리베로가 공격했을 때', '시간이 남았을 때', 1, '2점 차가 나야 세트를 이겨요.'],
    ['', '체육', 2, '축구 경기에서 한 팀의 선수 수(골키퍼 포함)는?', '11명', '9명', '10명', '12명', 1, ''],
    ['', '체육', 3, '축구에서 수비수가 자기 페널티 구역 안에서 반칙하면 주어지는 것은?', '페널티킥', '코너킥', '프리킥', '골킥', 1, ''],
    ['', '체육', 2, '축구에서 공이 골라인 밖으로 나갔는데 마지막으로 수비수가 건드렸다면?', '코너킥', '골킥', '스로인', '페널티킥', 1, ''],
    ['', '체육', 3, '축구에서 경고(옐로카드)를 한 경기에 두 번 받으면?', '퇴장', '교체', '페널티킥', '경기 무효', 1, ''],
    ['', '체육', 2, '배드민턴에서 셔틀콕이 바닥에 닿기 전에 몇 번까지 칠 수 있을까?', '1번', '2번', '3번', '제한 없음', 1, ''],
    ['', '체육', 3, '배드민턴 공식 경기는 몇 점 몇 게임제일까?', '21점 3게임제', '15점 3게임제', '11점 5게임제', '25점 2게임제', 1, ''],
    ['', '체육', 3, '배드민턴에서 네트 가까이에서 셔틀콕을 살짝 넘기는 기술은?', '헤어핀(네트 샷)', '스매시', '클리어', '드라이브', 1, ''],
    ['', '체육', 3, '야구에서 타자가 스트라이크 3개를 당하면?', '삼진 아웃', '볼넷', '안타', '홈런', 1, ''],
    ['', '체육', 3, '야구에서 볼 4개를 얻은 타자는?', '1루로 진루(볼넷)', '아웃', '2루로 진루', '타석 유지', 1, ''],
    ['', '체육', 2, '핸드볼에서 공을 가진 채 걸을 수 있는 최대 걸음 수는?', '3걸음', '2걸음', '5걸음', '제한 없음', 1, ''],
    // 육상·수영·기타
    ['', '체육', 3, '육상 단거리 경기에서 출발 신호 전에 출발하면?', '부정 출발', '재출발 없음', '2초 추가', '경고 없이 진행', 1, ''],
    ['', '체육', 2, '마라톤 풀코스의 거리는?', '42.195km', '21.1km', '10km', '50km', 1, ''],
    ['', '체육', 3, '육상 이어달리기에서 배턴을 주고받아야 하는 구역을 무엇이라 할까?', '테이크오버 존', '스타트 존', '피니시 존', '체인지 라인', 1, ''],
    ['', '체육', 3, '수영 영법 중 가장 빠른 것으로 알려진 것은?', '자유형(크롤)', '평영', '배영', '접영', 1, ''],
    ['', '체육', 2, '수영에서 개인혼영 순서로 옳은 것은?', '접영→배영→평영→자유형', '자유형→배영→평영→접영', '평영→접영→배영→자유형', '배영→접영→자유형→평영', 1, ''],
    ['', '체육', 3, '태권도에서 겨루기 경기 시 머리 공격이 허용되는 부위 보호구는?', '헤드기어(머리 보호대)', '정강이 보호대', '팔 보호대', '몸통 보호대만', 1, ''],
    ['', '체육', 2, '씨름에서 승부는 상대의 어디가 땅에 닿으면 결정될까?', '무릎 위 몸 어느 부분', '발바닥', '손가락', '머리카락', 1, ''],
    ['', '체육', 3, '올림픽은 몇 년마다 열릴까?', '4년', '2년', '3년', '5년', 1, '하계·동계가 2년 간격으로 번갈아 열려요.'],
    ['', '체육', 3, '근대 올림픽을 창시한 사람은?', '피에르 드 쿠베르탱', '사마란치', '토마스 바흐', '에디슨', 1, ''],
    ['', '체육', 2, '대한민국에서 열린 하계 올림픽은?', '1988 서울', '2008 베이징', '1964 도쿄', '2000 시드니', 1, ''],
    ['', '체육', 3, '2018 동계 올림픽이 열린 우리나라 도시는?', '평창', '서울', '부산', '강릉만', 1, '강릉은 빙상 경기장으로 함께 쓰였어요.'],
    ['', '체육', 3, '스포츠에서 상대를 존중하고 규칙을 지키는 정신을 무엇이라 할까?', '스포츠맨십', '홈 어드밴티지', '파울 플레이', '세리머니', 1, ''],
    ['', '체육', 3, '경기 중 심판의 판정에 불만이 있을 때 올바른 태도는?', '주장을 통해 정중하게 묻는다', '심판에게 소리친다', '경기장을 떠난다', '상대 선수를 밀친다', 1, ''],
    // 건강·영양
    ['', '건강', 2, '3대 영양소(에너지를 내는 영양소)로 짝지어진 것은?', '탄수화물·단백질·지방', '비타민·무기질·물', '탄수화물·비타민·물', '단백질·무기질·식이섬유', 1, ''],
    ['', '건강', 3, '탄수화물 1g, 단백질 1g이 내는 열량은 각각 약 몇 kcal일까?', '둘 다 4kcal', '둘 다 9kcal', '4kcal, 9kcal', '9kcal, 4kcal', 1, '지방은 1g당 9kcal로 가장 높아요.'],
    ['', '건강', 3, '체질량지수(BMI)를 구하는 식은?', '체중(kg) ÷ 키(m)²', '키(cm) − 100', '체중(kg) × 키(m)', '키(m) ÷ 체중(kg)', 1, ''],
    ['', '건강', 3, '뼈와 치아를 튼튼하게 하는 데 가장 필요한 무기질은?', '칼슘', '나트륨', '철', '아연', 1, ''],
    ['', '건강', 3, '혈액 속 헤모글로빈을 만들어 산소 운반을 돕는 무기질은?', '철', '칼슘', '마그네슘', '요오드', 1, '부족하면 빈혈이 생겨요.'],
    ['', '건강', 2, '청소년이 흡연하면 특히 해로운 이유로 알맞은 것은?', '성장 중인 폐와 뇌에 더 큰 손상을 준다', '키가 더 큰다', '집중력이 좋아진다', '해롭지 않다', 1, ''],
    ['', '건강', 3, '음료수 한 캔(250ml)에 들어 있는 당류는 보통 각설탕 몇 개 정도일까?', '약 7~9개', '약 1개', '약 20개 이상', '0개', 1, '하루 당류 권장량(약 50g)의 절반이 넘어요.'],
    ['', '건강', 2, '청소년에게 권장되는 하루 중강도 이상 신체활동 시간은?', '60분 이상', '10분', '3시간 이상', '하지 않아도 됨', 1, 'WHO 권고 기준이에요.'],
    ['', '건강', 3, '물을 충분히 마셔야 하는 이유로 알맞지 않은 것은?', '근육량이 바로 늘어난다', '체온 조절을 돕는다', '노폐물을 배출한다', '영양소를 운반한다', 1, ''],
    ['', '건강', 3, '스마트폰을 오래 보면 목이 앞으로 굽는 자세 문제를 무엇이라 할까?', '거북목 증후군', '오십견', '족저근막염', '테니스엘보', 1, ''],
    ['', '건강', 3, '성장호르몬이 가장 많이 분비되는 시간대로 알맞은 것은?', '밤에 깊이 잠들었을 때', '아침 식사 중', '운동 직후', '낮잠 잘 때만', 1, '밤 10시~새벽 2시 깊은 잠이 중요해요.'],
    ['', '건강', 2, '면역력을 높이는 생활 습관으로 알맞은 것은?', '규칙적인 운동과 충분한 수면', '밤새 게임하기', '끼니 거르기', '음료수로 물 대신하기', 1, ''],
    ['', '건강', 3, '스트레스를 건강하게 푸는 방법으로 알맞지 않은 것은?', '폭식하기', '가벼운 운동', '친구와 대화', '충분한 휴식', 1, ''],
    ['', '건강', 3, '하루 나트륨 섭취 권장량(WHO)은 약 얼마일까?', '2,000mg 미만', '10,000mg', '500mg 미만', '제한 없음', 1, '소금으로는 약 5g이에요.'],
    // 안전·응급처치
    ['', '안전', 3, '삔 곳 응급처치 "RICE"에서 C는 무엇을 뜻할까?', '압박(Compression)', '냉찜질(Cold)', '달리기(Cycling)', '확인(Check)', 1, 'R=휴식, I=얼음, C=압박, E=높이 올리기'],
    ['', '안전', 3, '심폐소생술에서 가슴 압박의 깊이는 성인 기준 약 얼마일까?', '약 5cm', '약 1cm', '약 10cm', '약 15cm', 1, ''],
    ['', '안전', 3, '자동심장충격기(AED) 패드를 붙이는 위치는?', '오른쪽 쇄골 아래와 왼쪽 옆구리', '양쪽 어깨', '배 가운데 두 장', '등에 한 장', 1, ''],
    ['', '안전', 2, '쓰러진 사람을 발견했을 때 가장 먼저 할 일은?', '의식과 반응을 확인한다', '물을 먹인다', '일으켜 세운다', '바로 가슴 압박을 한다', 1, '반응이 없으면 119 신고 후 심폐소생술!'],
    ['', '안전', 3, '운동 중 쥐(근육 경련)가 났을 때 올바른 처치는?', '경련 부위를 천천히 늘려 준다', '세게 두드린다', '계속 달린다', '뜨거운 물을 붓는다', 1, ''],
    ['', '안전', 3, '뼈가 부러진 것으로 의심될 때 올바른 처치는?', '움직이지 않게 고정하고 병원으로', '바로 잡아당겨 맞춘다', '걷게 해 본다', '뜨거운 찜질을 한다', 1, ''],
    ['', '안전', 3, '더운 날 운동 중 어지럽고 땀이 나지 않으며 체온이 매우 높다면 의심되는 것은?', '열사병', '감기', '저체온증', '근육통', 1, '즉시 119, 시원한 곳으로 옮기고 몸을 식혀요.'],
    ['', '안전', 2, '물에 빠진 사람을 발견했을 때 가장 안전한 행동은?', '주변에 알리고 구조 도구(튜브·막대)를 던진다', '바로 뛰어들어 헤엄쳐 간다', '모른 척한다', '사진을 찍는다', 1, ''],
    ['', '안전', 3, '화상을 입었을 때 올바른 처치는?', '흐르는 찬물에 10분 이상 식힌다', '얼음을 직접 댄다', '치약을 바른다', '물집을 터뜨린다', 1, ''],
    ['', '안전', 3, '운동장에서 번개가 칠 때 올바른 행동은?', '실내나 차 안으로 빨리 대피한다', '나무 밑으로 피한다', '운동을 계속한다', '우산을 높이 든다', 1, ''],
    ['', '안전', 2, '자전거·킥보드를 탈 때 반드시 착용해야 하는 것은?', '안전모(헬멧)', '선글라스', '이어폰', '장갑만', 1, ''],
    ['', '안전', 3, '교실·체육관에서 안전사고를 줄이는 행동으로 알맞지 않은 것은?', '젖은 바닥에서 달리기', '기구 사용 전 점검', '준비운동 하기', '주변 사람과 거리 두기', 1, '']
  ];
}
