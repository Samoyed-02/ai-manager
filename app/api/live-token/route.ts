import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

// Gemini 키를 쓰는 곳이라 백엔드 세션이 유효할 때만 발급한다
async function sessionStatus(authorization: string) {
    try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/sessions`, {
            headers: { Authorization: authorization },
            signal: AbortSignal.timeout(5000),
        });
        return res.status;
    } catch {
        return 502;
    }
}

export async function POST(req: Request) {
    const authorization = req.headers.get("authorization");
    if (!authorization) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const status = await sessionStatus(authorization);
    if (status === 401) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (status !== 200) return NextResponse.json({ error: "auth_unavailable" }, { status: 502 });

    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const now = Date.now();
    const token = await client.authTokens.create({
        config: {
            uses: 1,
            expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
            newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
            httpOptions: { apiVersion: "v1alpha" },
        },
    });

    return NextResponse.json({ token: token.name });
}
