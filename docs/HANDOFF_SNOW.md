# Snow 작업 인수인계

갱신: 2026-11-12 11:54 KST. 이 문서는 현재 코드와 작업 트리를 확인해 작성했다. 기존 인수인계 문서는 없었다. 이번 문서 작성에서는 코드 수정, 빌드 재실행, 서버 실행, Git 인덱스 변경을 하지 않았다.

## 목표와 완료 조건

- 08번 **Snow**에서 몸을 움직일 때 눈이 버벅이는 문제를 줄인다. 현재 기능·비주얼·그래픽을 유지하면서 최적화와 무손실 압축을 적용한다.
- 사용자가 요청한 동시 눈 개수 제한을 적용한다. 현재 설정은 **일반 기기 400개 / 저사양 기기 250개**이며, 내리는 눈과 몸에 쌓인 눈을 모두 포함한다.
- 유지할 기능: 화면 맨 위에 같은 높이로 배치된 큰 구름의 작은 좌우 움직임, 검지로 구름을 찔러 강설, HumanSeg 경계와 눈끼리의 충돌·쌓임·마찰·중력에 따른 낙하, 눈이 내릴 때 입을 벌려 넓게 퍼지는 김, 검지로 김 지우기/그리기, 시간에 따른 김 소멸.
- 구현과 정적 검증은 완료했다. **실제 카메라에서 몸을 움직이는 성능 및 시각 회귀 확인은 미완료**다. 새 Worker 적용 이후 사용자 확인은 아직 없다. 빌드 성공만으로 끊김 해결·발열 없음·모든 OS/인앱 호환을 확정하지 않는다.

## 작업 위치와 준수 사항

| 항목 | 현재 상태 |
| --- | --- |
| 작업 디렉터리 | `/Users/a/Documents/Git/Interactive-Web_6` |
| 브랜치 | `main` |
| 기준 커밋(HEAD) | `853892b0a48e02b16d8a16eb0cefe0199176a82b` |
| 커밋 제목 / 시각 | `1105` / 2026-11-05 12:37:37 +09:00 |
| 기술 구성 | Vite 8 / TypeScript 6 / Canvas 2D / MediaPipe Tasks Vision 0.10.32 |
| 변경 상태 | 아래 작업은 모두 미커밋. Snow 디렉터리 전체가 untracked 상태 |

- 먼저 `AGENTS.md`와 관련 구현을 읽고 프로젝트 구조를 파악한다.
- **개발 서버와 미리보기 서버는 사용자가 실행한다.** 에이전트는 `npm run dev`, `npm run preview`, 서버를 자동 실행하는 Playwright 등도 실행하지 않는다. 허용 검증은 서버 없는 빌드·정적 검사다.
- 현재 작업은 Snow에 한정한다. 기존 다른 예제 변경은 앞선 작업에서 남은 것이므로 임의로 수정·정리·되돌리지 않는다.
- 동물의 숲 후속 요청은 15번 `src/forest-edition/`만 대상으로 하고 13·14번은 보존한다.
- 화면에는 01–08만 표시된다. **07 WaterTouch / 08 Snow**가 현재 구성이다. 예전 09 Balloon은 제거되었고, 이전 Spiderman 시도는 취소된 상태이므로 복구하지 않는다.
- 인수인계 작성 후 추가 요청으로 Lemonade를 숨기고 Snow 메뉴를 09번에서 **08번**으로 변경했다. Lemonade 코드와 지연 로딩 경로는 보존하고 `VISIBLE_EXAMPLES`에서만 제외했다. 기존 빌드 검증 기록은 이 메뉴 변경 전 결과다.

## 완료한 변경

### Snow 기능과 그래픽

- `src/snow/main.ts`: 카메라·손·입 입력, Canvas 합성, 생명주기 관리. 08 선택 후 카메라 켜기를 눌러 시작한다.
- `clouds.ts`: 모바일 4개 / 데스크톱 5개의 큰 구름. 화면 상단에 약 10px 여백을 둔 같은 높이이며 작은 좌우 이동만 한다. 검지 찌르기로 약 6.5초 강설, 양손·여러 구름·빠른 손끝 경로를 지원한다.
- `tracker.worker.ts`: 얼굴 1개, 손 2개, Selfie Segmenter의 `selfie` 확률 마스크를 로컬 CPU/WASM으로 추론한다. 마스크는 카메라의 cover 크롭과 좌우 반전에 맞춰 투영한다.
- `body-field.ts` / `physics.ts`: 거리 필드와 법선을 이용한 사람 충돌, 눈끼리의 충돌, 중력·공기 저항·바람·정지/운동 마찰. 경계 갱신이 750ms 이상 오래되면 해당 지지를 사용하지 않는다.
- `fog.ts`: 입 주변에서 넓게 퍼지는 김, 양손 검지 지우기, 지운 자국 유지·감쇠, 김의 자연 소멸. 화면 크기 변경 시 김과 그림을 보존한다.
- 깨짐 개선: 한 프레임의 카메라와 구름·눈을 offscreen Canvas에 먼저 완성한 뒤 같은 장면으로 김을 합성한다. Canvas GPU 필터 대신 단계적인 축소·확대 흐림을 사용한다. 김 마스크 긴 변 640셀, 부드러운 지우기 경계, 여백 있는 고해상도 구름 스프라이트, 눈의 착지 전후 동일한 스프라이트를 유지한다.

### 가장 최근의 버벅임 대응

- **새 물리 Worker** `simulation.worker.ts`: 원래 UI 스레드에 있던 사람 거리 필드 갱신과 눈 물리 계산을 분리했다. 추론 Worker와는 별개다.
- `simulation.ts`: UI 측 중개 계층. 물리 요청을 하나만 진행하며, 대기 중인 몸 마스크는 최신 것 하나로 교체해 오래된 윤곽 갱신이 밀리지 않게 한다. 눈이 없고 생성 요청도 없으면 물리 요청을 쉰다.
- 결과는 안정적인 눈 ID와 `Float64Array`에 담아 transferable 버퍼로 전달하고 다음 요청에서 버퍼를 재사용한다. `SNAPSHOT_STRIDE = 6`: ID, x, y, radius, age, angle.
- 렌더링 객체를 재사용하고 `1 - exp(-dt * 40)`으로 위치·회전을 보간한다. 기존 결정 스프라이트와 물리 계산식은 유지했다.
- `revision`으로 크기 변경·초기화 이전의 늦은 결과를 무시한다. 카메라 해제·예제 이탈 시 두 Worker와 카메라 트랙을 종료한다. 백그라운드 복귀 후에는 사용자가 카메라를 다시 켠다.
- Worker 생성/처리 실패 또는 초기화 15초 초과 시 동일한 `SnowPhysics`와 `BodyField`를 사용하는 로컬 계산으로 대체한다.
- `simulation-protocol.ts`: `SNOW_LIMIT = 400`, `LOW_POWER_SNOW_LIMIT = 250`. `main.ts`에서 CPU 논리 코어 4개 이하 또는 `deviceMemory` 4GB 이하이면 저사양 분기를 사용한다. 정보가 없으면 각각 8로 간주한다.
- `physics.ts`에서 **생성 전** 남은 개수만 허용한다. 상한에서 기존 눈을 삭제하지 않고 새 생성만 멈춘다. 화면 밖으로 나가거나 수명이 끝나면 다시 생성할 수 있다. 눈은 기존처럼 33초부터 흐려지고 38초에 제거된다.
- 충돌 버킷 배열 풀, 접촉 결과 객체 재사용, 입자 배열의 제자리 정리 등 이전의 메모리 할당 최적화도 유지한다.

### 앞선 공통 최적화 및 압축(현재 작업 트리에 포함)

- `src/lazy-example.ts`와 `src/main.ts`: 6개 카메라 예제를 선택할 때 초기화한다. 로딩 중 다른 예제로 이동하면 뒤늦게 활성화하지 않는다. 기존 CSS 순서는 보존했다.
- `src/vision-frame.ts`: 직접 ImageBitmap → 캔버스 ImageBitmap → transferable ImageData 순의 캡처 대체 경로와 프레임 자원 해제. WaterTouch·Shampoo·공용 손 추론 Worker에도 앞선 변경이 남아 있다.
- `src/compatibility.ts`: 없는 API에 한해 Array.at, crypto.randomUUID, Canvas.roundRect, ResizeObserver 대체 구현. 100vh CSS 대체값도 있다.
- 빌드 대상 ES2020, CSS Chrome 80 / Safari 14 / Firefox 78. 이것은 **실제 해당 환경에서 검증했다는 뜻이 아니다**.
- `scripts/compress-build.mjs`: 빌드 후 gzip(9)·Brotli(9)를 `dist-compressed/`에 생성하고 원본과 압축 해제 결과의 바이트 일치를 검증한다. 원본 모델·이미지는 수정하지 않는다.
- `server/compressed-assets.ts`: Vite preview용 압축 협상 및 Content-Encoding/Vary, 캐시·경로·수정 시각 검사. 일반 배포 호스트는 별도 헤더/서빙 지원이 필요하다.
- 압축 사본은 GitHub Pages의 `dist` 배포물에 중복 포함하지 않는다. Pages의 실제 전송 압축은 호스트 동작에 따르므로 생성된 파일만으로 제공 여부를 단정하지 않는다.

## 미커밋 변경 목록

2026-11-12 11:54 KST, 문서 생성 직전의 `git status --short` 기준이다. 아래는 모두 앞선 작업에서 이미 존재했다. 스테이징된 변경은 없었다.

```text
 M .gitignore
 M AGENTS.md
 M README.md
 M package.json
 D src/balloon.css
 D src/balloon.ts
 M src/guestbook/main.ts
 M src/hand-landmarker.worker.ts
 M src/lemonade.css
 M src/lemonade.ts
 M src/main.ts
 M src/shampoo.ts
 M src/style.css
 M src/water-touch.ts
 D tests/balloon.spec.ts
 M vite.config.ts
?? scripts/compress-build.mjs
?? server/compressed-assets.ts
?? src/compatibility.ts
?? src/lazy-example.ts
?? src/vision-frame.ts
?? src/snow/body-field.ts
?? src/snow/clouds.ts
?? src/snow/fog.ts
?? src/snow/main.ts
?? src/snow/physics.ts
?? src/snow/simulation-protocol.ts
?? src/snow/simulation.ts
?? src/snow/simulation.worker.ts
?? src/snow/style.css
?? src/snow/tracker.worker.ts
?? src/snow/types.ts
```

이 목록에 이번에 새로 작성한 `docs/HANDOFF_SNOW.md`가 추가된다. `dist/`, `dist-compressed/`, `certs/`는 ignored 상태다. `git diff`만으로는 untracked 상태의 Snow 구현이 표시되지 않으므로 재개 시 각 파일도 직접 읽는다.

## 중요한 결정과 관찰된 결과

| 결정 또는 이전 시도 | 이유 / 관찰 |
| --- | --- |
| 그래픽 해상도·눈 스프라이트·120Hz 물리 계산식을 낮추지 않고 Worker 분리 | 기능과 비주얼 유지 요구를 지키면서 UI 스레드의 계산 경합을 줄이기 위함. 실제 기기에서의 개선 폭은 미측정 |
| 최신 마스크만 처리, 진행 중 물리 요청 하나 | 오래된 몸 윤곽 처리와 메시지 적체 방지 |
| 400/250개 상한에서 새 생성만 멈춤 | 충돌 부하와 메모리를 제한하되 기존에 쌓인 눈이 갑자기 사라지지 않게 함 |
| 무손실 전송 압축 | 다운로드 용량을 줄이면서 원본 그래픽·모델 바이트를 유지. 압축은 실행 중 충돌 계산 부하 자체를 줄이지는 않음 |
| 이전 공통 최적화와 배열 재사용 | 빌드는 통과했지만 사용자가 여전히 몸을 움직일 때 눈이 많이 버벅인다고 보고함. 이 피드백을 받아 이번 물리 Worker 분리를 추가 |
| 이전 김/구름 그래픽 처리 | 사용자가 깨짐을 보고한 뒤 단일 장면 합성·필터 없는 흐림·구름 스프라이트 여백으로 교체. 이후 큰 김과 큰 구름, 상단 동일 높이 배치 요청을 반영 |
| HTTP LAN 접속에서 카메라 권한창이 안 뜸 | 사용 주소가 `http://192.168.35.210:5173/`였음. 보안 컨텍스트 제한으로 판단, HTTPS/localhost 안내 및 로컬 인증서 경로 설정 |
| 로컬 인증서 신뢰 설치 | 이전 `mkcert -install`은 관리자 암호가 필요해 완료하지 못함. 사용자가 신뢰 설치를 마쳤는지는 미확인. 인증서가 있으면 Vite 설정에서 읽으며 키 내용은 문서에 복사하지 않음 |

## 실행한 검증과 시점

| 시점(KST) | 명령 / 범위 | 결과 |
| --- | --- | --- |
| 2026-11-12 11:14:55 완료 로그 기준 | `npm run build` = `tsc && tsc -p tsconfig.node.json && vite build && node scripts/compress-build.mjs` | 종료 코드 0. 최신 마스크 통합·idle 처리까지 포함한 최종 Snow 코드의 타입 검사와 정적 빌드 통과. 물리 Worker 번들 생성 |
| 같은 빌드 | 압축 스크립트의 원본/해제 바이트 비교 | 통과. 압축 대상 합계 67.25MB → Brotli 43.03MB / gzip 44.67MB. **전체 페이지 최초 다운로드나 FPS 수치가 아님** |
| 같은 빌드 후 | `git diff --check` | 종료 코드 0, 공백 오류 없음 |
| 2026-11-12 11:53–11:54, 이번 문서 갱신 | `pwd`, `git branch --show-current`, `git log -1`, `git status --short`, `git diff --stat`, `git ls-files --others --exclude-standard`, 관련 소스/README/로그 읽기 | 현재 경로·브랜치·기준 커밋·미커밋 파일을 확인. 이번에는 빌드를 다시 실행하지 않음 |

- 빌드에는 500KB를 넘는 일부 청크 경고가 남아 있다. 실패는 아니며, 이번 물리 Worker 최적화로 모든 청크 경고가 해결된 것은 아니다.
- 최종 빌드 로그: `/tmp/snow-final-build.log`. 임시 파일이므로 다른 세션/재부팅 후 없어질 수 있다. 압축 상세 보고서: `dist-compressed/compression-report.json`(ignored).
- 이번 Snow Worker 변경에 대해 실제 카메라 실행, 브라우저 E2E, FPS/긴 작업/발열 측정은 하지 않았다. 서버 자동 실행 제한을 준수했다.

## 미완료 작업·미확인 가정

- 가장 큰 미확인 사항: 새 Worker 적용 후 몸을 움직일 때 실제 버벅임이 충분히 줄었는지. Worker 분리는 UI 점유를 줄이지만 총 CPU 사용량 감소나 무발열을 보장하지 않는다.
- HumanSeg 자체는 일반 160ms / 저사양 240ms 간격이다. 얼굴·손 추론 요청 간격은 일반 최소 65ms / 저사양 100ms이며, 캡처 긴 변은 640/480px다. 몸 윤곽의 계단식 갱신이 여전히 보이는지 확인해야 한다. 현재 화면 합성은 최대 약 30fps이며 120Hz는 물리 내부 간격이다.
- 위치 보간이 빠른 몸 이동에서 눈이 몸보다 늦게 따라오는 인상을 주거나 경계 안에 잠깐 보이는지 미확인이다.
- 눈이 제한까지 쌓였을 때의 밀집 충돌 비용, 개수 상한 및 공간이 생긴 뒤 생성 재개를 실기기에서 확인하지 않았다. 코드상 생성 전 제한은 UI 중개층과 물리 계산 양쪽에 있다. DOM `data-snow-limit` / `data-snowflakes`로 현재 설정·개수를 확인할 수 있다.
- Worker 실패 대체 경로는 UI 스레드에서 계산하므로 같은 성능을 보장하지 않는다. 실행 중 Worker 오류 시 현재 대체 구현은 물리를 새로 만들어 기존 눈이 초기화될 수 있다. 이 경로의 연속성은 별도 미확인 문제다.
- Worker/버퍼 전송과 `revision` 처리가 크기 변경·카메라 재연결·빠른 예제 전환에서도 올바른지는 정적 확인만 했다.
- iOS/Android/각 인앱 브라우저의 카메라 권한, 모듈 Worker·MediaPipe/WASM, HTTPS 인증서 신뢰 및 배포 경로를 실기기에서 확인하지 않았다. 추론 Worker의 WASM 로더가 간접 eval을 사용하므로 엄격한 CSP 환경도 미확인이다.
- Snow 전용 자동화 테스트는 추가하지 않았다. 삭제된 Balloon 테스트를 현재 Snow 검증으로 간주하지 않는다.

## 다음에 실행할 구체적인 단계

1. 이 문서와 `AGENTS.md`, `src/snow/{main,simulation,simulation.worker,simulation-protocol,physics,body-field,tracker.worker}.ts`를 읽는다. `git status --short`와 HEAD를 다시 확인하고 위 스냅샷과 구분한다. untracked 소스를 놓치지 않는다.
2. 사용자의 최신 피드백과 사용 기기/브라우저, 보안 접속 주소를 확인한다. 서버가 필요하면 사용자가 실행하도록 한다. 에이전트가 서버를 시작하거나 자동 시작하는 테스트를 실행하지 않는다.
3. 사용자가 실행한 HTTPS 환경에서 눈이 없을 때 / 강설 중 / 몸에 많이 쌓였을 때를 비교한다. 정지·좌우 이동·팔 움직임에서 화면 끊김, 윤곽 반응, 보간 지연을 구분한다. 가능하면 사용자 측 성능 기록에서 UI 그리기, 추론 Worker, 물리 Worker 시간을 나눠 확인한다.
4. 일반 400 / 저사양 250개 상한, 상한 도달 후 기존 눈 보존, 눈 제거 후 생성 재개를 확인한다. 구름 위치·찌르기, 눈의 크기·모양·쌓임·미끄러짐, 김 생성·지우기·소멸도 함께 비교한다.
5. 전환·백그라운드·크기 변경·재연결과 Worker 실패 대체 경로를 확인한다. 문제가 재현되면 관측된 병목에 한해 Snow 내부를 수정한다. 시각 품질이나 물리 해상도를 임의로 낮추지 않는다.
6. 코드 변경이 승인된 후에는 `git diff --check`와 `npm run build`로 서버 없는 검증을 수행하고 결과·시각을 이 문서에 갱신한다. 배포 시에는 실제 Content-Encoding/Vary와 Worker·모델 경로를 별도로 확인한다. 커밋/배포는 요청 없이 진행하지 않는다.
