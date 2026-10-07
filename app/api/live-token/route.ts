import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    if (req.headers.get("x-app-passcode") !== process.env.APP_PASSCODE) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

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