import { type OpenAIListModelResponse } from "@/app/client/platforms/openai";
import { getServerSideConfig } from "@/app/config/server";
import { GEMINI_PRO, OpenaiPath } from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../auth";
import { GptBodyValue, formatterGemini, requestOpenai } from "../../common";
import { NextApiRequest, NextApiResponse } from "next";
const serverConfig = getServerSideConfig();
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAIKey = serverConfig.googleApiKey;
// Access your API key as an environment variable (see "Set up your API key" above)
const genAI = new GoogleGenerativeAI(genAIKey);

async function handle(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const authResult = auth(req as any);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }
  const reqBody: GptBodyValue = await req.json();
  const geminiBody = formatterGemini(reqBody);
  const controller = new AbortController();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?key=${genAIKey}`,
    {
      headers: {
        "content-type": "application/json",
      },
      method: req.method,
      body: JSON.stringify(geminiBody),
      redirect: "manual",
      // @ts-ignore
      duplex: "half",
      signal: controller.signal,
    },
  );
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export const GET = handle;
export const POST = handle;

export const runtime = "edge";
export const preferredRegion = [
  "arn1",
  "bom1",
  "cdg1",
  "cle1",
  "cpt1",
  "dub1",
  "fra1",
  "gru1",
  "hnd1",
  "iad1",
  "icn1",
  "kix1",
  "lhr1",
  "pdx1",
  "sfo1",
  "sin1",
  "syd1",
];
