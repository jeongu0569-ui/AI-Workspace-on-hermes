# 내장 모델 설정 런타임

## 목적

`codmes model`은 단순한 provider/model 목록을 새로 구현하지 않는다. Hermes Agent
0.18.0의 모델 설정, provider 분기, API key/OAuth, custom endpoint, 모델 조회
TUI 소스를 Codmes 저장소에 포함하고 Codmes 설정 저장소에 연결한다.

```text
codmes model
  -> vendor/hermes-agent/aiw_model.py
  -> vendored hermes_cli model flow
  -> <Workspace>/.codmes/config/config.yaml
  -> <Workspace>/.codmes/config/auth.json
  -> Codmes OpenAI-compatible runtime
```

외부 `hermes` 실행파일이나 `hermes serve`를 호출하지 않는다. 사용되는 원본 코드는
MIT 라이선스이며 `vendor/hermes-agent/LICENSE`와 출처 기록을 함께 보존한다.

## 설치

내장 Python 런타임은 다음 명령으로 준비한다.

```bash
npm run runtime:bootstrap
```

저장소의 `.codmes-runtime` 가상환경에 벤더링된 소스와 정확한 core dependency를
설치한다. 이 폴더는 Git에 포함하지 않는다. Python 선택 우선순위는 다음과 같다.

1. `CODMES_RUNTIME_PYTHON`
2. 저장소의 `.codmes-runtime`
3. 저장소의 일반 `.venv`
4. 벤더 디렉터리의 `.venv`
5. 이전 Hermes 설치의 Python 환경 (migration fallback)
6. 의존성이 이미 설치된 `python3` 또는 `python`

기존 `AIW_RUNTIME_PYTHON`은 호환 fallback으로만 읽습니다.

## 설정 사용

전체 대화형 설정:

```bash
CODMES_WORKSPACE_ROOT="$HOME/CodmesWorkspace" codmes model
```

자동화용 비대화형 명령은 그대로 유지한다.

```bash
codmes model show
codmes model list
codmes model set-default ollama-local gemma4:e2b-mlx
```

TUI가 `provider`, `model.base_url`, `api_mode` 형식으로 저장한 endpoint를
Codmes 런타임이 직접 읽는다. 이전 custom endpoint 설정도 호환한다.
다만 사용자-facing provider 목록은 현재 OpenAI Codex와 Ollama 계열만 노출한다.
Anthropic, Bedrock, Copilot ACP 등은 transport 이식이 완료되기 전까지 앱/설정
화면에서 숨긴다.

## Provider transport 원칙

Provider 목록과 인증 UI만 가져오면 충분하지 않다. Hermes Agent의 실제 실행 로직은
provider별 transport에 분리되어 있고, 대표적으로 다음 파일들이 관여한다.

- `hermes_cli/runtime_provider.py`: provider, credential, base URL, `api_mode` 해석
- `agent/transports/codex.py`: Responses API transport
- `agent/codex_responses_adapter.py`: chat message와 tool schema를 Responses 형식으로 변환
- `agent/anthropic_adapter.py`: Anthropic Messages protocol
- `agent/bedrock_adapter.py`: AWS Bedrock Converse protocol

따라서 Codmes 런타임은 provider catalog만 복사하지 않고, provider별 wire
protocol까지 단계적으로 이식한다. 현재 구현 상태는 다음과 같다.

- OpenAI-compatible `/chat/completions`: 기존 JS runtime에서 처리
- Ollama Local: OpenAI-compatible `/v1/chat/completions` endpoint로 처리
- OpenAI Codex: Codex OAuth token, refresh, ChatGPT Codex `/responses` transport 처리
- Anthropic native, Bedrock Converse, Copilot ACP 등: 상세 transport 이식 예정이며
  현재 사용자-facing provider 목록에서는 숨김

즉 `openai-codex` 같은 provider는 단순히 API key를 붙여 `/chat/completions`에
보내면 안 된다. Codex backend는 `https://chatgpt.com/backend-api/codex/responses`
를 사용하고, `originator`, Codex CLI 스타일 `User-Agent`, `ChatGPT-Account-ID`
헤더와 Responses request shape가 필요하다.

## OpenAI Codex

`codmes model`에서 OpenAI Codex OAuth를 완료하면 credential은 Workspace의
`.codmes/config/auth.json`에 저장된다. Codmes runtime은 이 값을 직접
읽어 다음 절차를 수행한다.

1. `credential_pool.openai-codex[0]`에서 access token과 refresh token을 읽는다.
2. access token JWT의 만료 시간이 가까우면 OpenAI OAuth token endpoint에서 refresh한다.
3. 갱신된 token은 다시 `auth.json`에 저장한다.
4. `/chat/completions`가 아니라 `/responses`로 streaming request를 보낸다.
5. `response.output_text.delta`, reasoning, function call item을 Codmes event로 변환한다.

이 수정 전에는 OpenAI Codex를 OpenAI-compatible chat-completions처럼 호출해서
HTML 403 응답이 발생했다. 현재 테스트에서는 Codex backend 호출까지 정상 도달하며,
계정 사용량이 소진된 경우에는 403이 아니라 Codex backend의 `usage_limit_reached`
429가 반환된다.

로컬 graphical session에서 `codmes model`의 Codex device-code 로그인은 인증 URL을
자동으로 브라우저에 열도록 벤더링된 `hermes_cli/auth.py`를 패치했다. 원격 SSH나
headless 환경에서는 기존처럼 URL과 code를 출력한다.

## Ollama

Ollama 0.31.2에서 `ollama launch hermes --config`를 격리 HOME으로 실행해 확인한
결과, Ollama는 지원 integration 이름과 각 제품의 설정 파일 생성 로직을 자체
바이너리에 포함한다. 따라서 Codmes 저장소만 수정해서
`ollama launch codmes`라는 literal command를 추가할 수 없다. Ollama upstream에
`codmes` integration이 등록되어야 한다.

Codmes의 기본 모델 picker에는 다음 구조를 추가했다.

```text
Ollama ▸
  Ollama Local
  Ollama Cloud
```

`Ollama Local`은 API key를 요구하지 않고 `/api/tags`에서 completion/tools/thinking
기능이 있는 모델만 조회하며 `provider: ollama-local`로 저장한다. CLI 단축 경로도
같은 provider를 사용한다.

```bash
codmes ollama
codmes ollama --model gemma4:e2b-mlx
codmes ollama --model gemma4:e2b-mlx --serve
```

이 명령은 `GET http://127.0.0.1:11434/api/tags`로 설치 모델을 확인하고,
`http://127.0.0.1:11434/v1`을 `ollama-local` endpoint로 저장한다.

## Apple 앱 GUI

앱의 `Settings > Model & Provider`는 다음 Workspace Server API를 사용한다.

- `GET /api/providers`
- `GET /api/providers/:id/models`
- `POST /api/auth/:provider`
- `POST /api/model/default`

API key와 endpoint는 서버에만 저장되고 앱은 기존 secret 값을 다시 내려받지 않는다.
Provider 화면은 `Accounts`, `API Keys`, `Local` 섹션으로 나뉘며 provider를
선택할 때마다 서버의 모델 목록을 다시 조회한다. Ollama Local 모델 조회도 Workspace
Server가 수행하므로 iPhone은 Ollama에 직접 연결하지 않는다. OAuth provider는 별도
OAuth 시작/상태/callback API가 추가될 때까지 서버의 `codmes model`에서 인증한다.

## 검증 항목

- 벤더링된 TUI에서 34개 provider/action 행 출력
- 임시 Workspace에서 `ollama-local` endpoint와 모델 저장
- `codmes model show/list`에서 저장 결과 확인
- 로컬 `gemma4:e2b-mlx`로 Codmes 자체 런타임 스트리밍 응답 확인
- OpenAI Codex가 `/responses` transport를 사용하고 HTML 403이 재발하지 않는 테스트
- OpenAI Codex token-only credential이 configured provider로 표시되는 테스트
- 실제 OpenAI Codex prompt가 backend까지 도달하는 수동 테스트
- Hermes-compatible custom config 회귀 테스트
- 모델 TUI가 Workspace별 설정 경로를 사용하는 테스트
- macOS/iOS 설정 GUI 빌드 및 provider 관리 API 실호출
