# AI Manager (웹)

채팅과 음성 통화를 오가도 같은 기억과 도구를 쓰는 개인 AI 비서의 웹 앱(PWA)입니다.
서버는 [ai-manager-server](https://github.com/Samoyed-02/ai-manager-server) (Kotlin, Spring Boot, Claude API)에 있습니다.

## 주요 기능

- **호출어 음성 통화:** "수피"라고 부르면 듣기 시작합니다. 호출어는 브라우저 음성 인식(Web Speech API)으로 기기 안에서 감지하고, 부른 뒤에만 Gemini Live로 소리를 보내 음성 API 과금을 줄입니다. 이름을 부르기 직전 2.5초는 버퍼에 담아 두었다가 함께 보내 첫마디가 잘리지 않습니다.
- **API 키 보호:** 브라우저는 Gemini 키를 받지 않습니다. `app/api/live-token`이 서버 세션을 확인한 뒤 일회용 토큰만 발급합니다.
- **통화 기록 유실 방지:** 통화 대화는 로컬 대기열에 먼저 저장하고 서버로 보냅니다. 네트워크가 끊기면 다음 접속 때 보낸 위치부터 이어서 보냅니다.
- **채팅·음성 도구 공유:** 서버의 도구 목록(`GET /tools`)을 음성 모델에 등록하고, 음성에서 부른 도구를 서버(`POST /tools/{name}`)로 전달합니다.
- **채팅:** SSE 스트리밍 답변, 서버가 실행한 작업 표시, 문서 작업 카드
- **관리 화면:** 기기(로그인 세션), 기억, 알림, 루틴, 활동, 목표, 주간 회고
- **로그인:** 비밀번호 + TOTP 2단계 인증. 시도 제한(429)에 걸리면 남은 시간을 보여 줍니다.

## 구조

```
브라우저 ──Bearer──▶ ai-manager-server (채팅 SSE, 기록, 도구)
   │
   ├─▶ /api/live-token (Next.js 서버) ──세션 확인──▶ ai-manager-server
   │        └─ Gemini 일회용 토큰 발급
   └─▶ Gemini Live (음성, "수피" 호출 뒤에만 소리 전송)
```

| 위치 | 내용 |
|---|---|
| `app/voice` | 통화 화면. 호출어 감지, 오디오 스트리밍, 소리 크기에 반응하는 원 |
| `lib/wake-gate.ts` | 호출 전후로 소리를 보낼지 정하는 문(직전 버퍼, 후속 질문 대기) |
| `lib/call-record.ts` | 통화 기록 대기열, 나눠 보내기, 재시도 |
| `lib/voice-tools.ts` | 음성 도구 선언과 서버 중계 |
| `lib/api.ts` | 인증, 오류 처리, SSE 파서 |
| `public/pcm-recorder.js` | AudioWorklet. 16kHz PCM을 100ms 단위로 자름 |

## 기술 스택

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Gemini Live API (`@google/genai`), Web Audio API, Web Speech API, Vercel

## 실행

```bash
cp .env.example .env.local   # 서버 주소와 Gemini API 키를 채운다
npm install
npm run dev                  # http://localhost:3000
npm test                     # 단위 테스트 (node:test)
```

호출어 감지는 Web Speech API를 지원하는 브라우저(Chrome, Safari)에서 동작합니다.
