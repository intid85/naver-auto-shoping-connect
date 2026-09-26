# 네이버 쇼핑커넥트 글발행 기준 패키지

이 폴더는 2026-09-26에 실제 임시저장 테스트를 통과한 쇼핑커넥트 글발행 방식의 기준본이다. 이상 작동 시 추측부터 하지 말고 아래 순서로 확인한다.

1. 다른 AI 에이전트나 프로그램은 `agent-workflow.json`을 먼저 읽는다.
2. Codex/ChatGPT 계열 에이전트는 `skill/naver-shopping-connect-publish/SKILL.md`도 읽는다.
3. Drive 백업에서는 현재 프로그램과 `program-current`를 비교한다. GitHub에서는 저장소 루트의 코드가 기준본이다.
4. `recovery-manifest.json`의 SHA-256으로 핵심 파일이 같은지 확인한다.
5. 차이가 있어도 현재 프로그램을 바로 덮어쓰지 않는다. 현재본을 보관하고 diff를 확인한 뒤 필요한 부분만 복원한다.

## 이 패키지가 보장하는 작업 방식

- 일반 정보성 글과 분리된 쇼핑커넥트 전용 흐름
- 기존 원고, 사진, 기발급 쇼핑커넥트 정보 사용
- 제목과 본문을 클립보드 붙여넣기로 입력
- 본문 최상단과 해시태그 바로 위에 상품 카드 2개
- 원시 HTTP 쇼핑커넥트 주소 미노출
- 문단 사이 사진 위치 유지
- 영문 사진 자리표시자 완전 제거
- 사진 수와 상품 카드 수를 검증한 뒤에만 임시저장

## 빠른 실행

```powershell
cd C:\Users\leehansung\naver-auto
npm install
npm run check
npm run parse
npm run post
```

테스트 시 `config.json`은 `mode: "draft"`, `limit: 1`, `headless: false`를 유지한다. 공개 발행과 초안 삭제는 별도 지시 없이는 실행하지 않는다.

## 포함/제외

- `program-current`: Drive 백업에 포함되는 프로그램 소스와 설정의 기준 복사본(GitHub에서는 저장소 루트 코드 사용)
- `skill`: 사람이 읽기 쉬운 에이전트 스킬
- `agent-workflow.json`: 제품에 종속되지 않은 기계 판독용 작업 정의
- `recovery-manifest.json`: 버전, 해시, 제외 항목
- 제외: `node_modules`, Git 내부정보, 로그인 세션, 토큰, 실행 로그, 테스트 게시물 원본

로그인 세션은 `C:\Users\leehansung\.naver-auto\naver-state.json`에 따로 있으며 이 백업에 들어 있지 않다.
