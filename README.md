# naver-auto — 네이버 블로그 폴더 자동 임시저장

폴더(제목·본문·사진)를 읽어 네이버 블로그에 **임시저장**한다.
태그·커넥트 상품·예약발행은 발행할 때 손으로 (계정 안전).

## 처음 1회 세팅

Node 는 `C:\Program Files\nodejs\node.exe` 에 있음. PowerShell:

```
cd "C:\Users\intid\OneDrive\Desktop\naver-auto"
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\node.exe" login.js
```

`login.js` → 크롬 창에서 네이버 로그인 (로그인 상태 유지 O / IP보안 OFF) →
로그가 `NID_AUT=O` 되면 채팅/사람에게 "완료" 신호. 세션은
`C:\Users\intid\.naver-auto\naver-state.json` 에 저장됨 (OneDrive 밖, 안 풀림).

세션 확인: `& "C:\Program Files\nodejs\node.exe" check-login.js`

## 폴더 넣기

`posts/` 안에:
```
posts/
  01_iphone17pro/
    붙여넣기본문.txt      (제목 / 마커 / 본문 / #태그 줄)
    photos/ 01.jpg 02.jpg ...
  02_.../
```
본문 규칙: 문단 사이 빈 줄 1개, **사진 자리는 빈 줄 2개 이상**, 맨 아래 `#태그`.

## 실행

```
& "C:\Program Files\nodejs\node.exe" parse-check.js   # 파싱 미리보기 (발행 안 함)
& "C:\Program Files\nodejs\node.exe" taglist.js       # 태그목록.txt 생성 (발행용 복붙)
& "C:\Program Files\nodejs\node.exe" post.js          # 실제 임시저장
& "C:\Program Files\nodejs\node.exe" shot.js          # 최신 임시글 캡처+검증
```

## config.json

| 키 | 뜻 |
|---|---|
| blogId | `forest_605` (블로그 주소 아이디) |
| mode | `draft` 고정 (임시저장) |
| centerAlign | true = 가운데 정렬 |
| betweenPostsDelaySec | 글 사이 대기초. 30개면 90~120 권장 |
| startFrom | N번째 폴더부터 (중단 후 이어하기) |
| limit | 이번에 최대 몇 개. 0=전부, 테스트는 1 |

## 동작 방식 (post.js)

1. 제목 입력
2. **본문 전체를 먼저 타이핑** (사진 자리엔 임시 마커 `ZZIMGSLOTZZ0`…)
   - 문장마다 Escape → Enter (네이버 '글감 자동완성'이 Enter 가로채는 것 방지)
3. 마커를 **뒤에서부터** 찾아 사진으로 교체
4. 전체 선택 → 상속된 취소선/굵게 등 해제
5. 가운데 정렬
6. 임시저장 → 브라우저 종료(안 닫으면 네이버가 '편집중'으로 잠금)

## 발행 (사장님이 수동, 글당 1~2분)

1. 네이버 블로그 > 글쓰기 > 우측 상단 "저장 N" > 최신 글 불러오기
2. `태그목록.txt` 에서 해당 글 태그 복사 → 발행창 태그칸
3. 쇼핑커넥트 상품 첨부
4. 예약발행 시각 잡고 발행

## 알려진 한계

- 스마트에디터 UI 바뀌면 `post.js` 셀렉터 수정 필요
- 대량 커넥트 글 몰아 발행 = 저품질 위험. 하루 2~3개 권장
- 캡차 뜨면 사람이 풀어야 함
- `logs/` (`C:\Users\intid\.naver-auto\logs`) 에 오류 스크린샷
