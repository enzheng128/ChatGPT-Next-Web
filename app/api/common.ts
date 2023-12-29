import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "../config/server";
import { COPILOT_BASE_URL, DEFAULT_MODELS, OPENAI_BASE_URL } from "../constant";
import { collectModelTable } from "../utils/model";
import { makeAzurePath } from "../azure";
import crypto from "crypto-js";
// @ts-ignore
import { v4 } from "uuid";

const serverConfig = getServerSideConfig();

const machine_id = crypto.SHA256(v4()).toString(crypto.enc.Hex);
let accessToken = {
  token: "",
  expire: 0,
};

export async function requestOpenai(req: NextRequest) {
  const controller = new AbortController();

  const authValue = req.headers.get("Authorization") ?? "";
  const authHeaderName = serverConfig.isAzure ? "api-key" : "Authorization";
  const isCopilot =
    !serverConfig.azureUrl &&
    !serverConfig.baseUrl &&
    !!process.env.COPILOT_TOKEN;
  let path = `${req.nextUrl.pathname}${req.nextUrl.search}`.replaceAll(
    isCopilot ? "/api/openai/v1/" : "/api/openai/",
    "",
  );

  let baseUrl = isCopilot
    ? COPILOT_BASE_URL
    : serverConfig.azureUrl || serverConfig.baseUrl || OPENAI_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy] ", path);
  console.log("[Base Url]", baseUrl);
  // this fix [Org ID] undefined in server side if not using custom point
  if (serverConfig.openaiOrgId !== undefined) {
    console.log("[Org ID]", serverConfig.openaiOrgId);
  }

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  if (serverConfig.isAzure) {
    if (!serverConfig.azureApiVersion) {
      return NextResponse.json({
        error: true,
        message: `missing AZURE_API_VERSION in server env vars`,
      });
    }
    path = makeAzurePath(path, serverConfig.azureApiVersion);
  }

  const fetchUrl = `${baseUrl}/${path}`;
  const copilotAccessToken = isCopilot ? await checkAndGeToken() : null;
  const headers: any = isCopilot
    ? {
        Host: "api.githubcopilot.com",
        Authorization: `Bearer ${copilotAccessToken}`,
        "X-Request-Id": v4(),
        "X-Github-Api-Version": "2023-07-07",
        "Vscode-Sessionid": String(v4()) + Date.now(),
        "vscode-machineid": machine_id,
        "Editor-Version": "vscode/1.85.0",
        "Editor-Plugin-Version": "copilot-chat/0.11.1",
        "Openai-Organization": "github-copilot",
        "Copilot-Integration-Id": "vscode-chat",
        "Openai-Intent": "conversation-panel",
        "Content-Type": "application/json",
        "User-Agent": "GitHubCopilotChat/0.11.1",
        Accept: "*/*",
        "Accept-Encoding": "gzip, deflate, br",
      }
    : {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        [authHeaderName]: authValue,
        ...(serverConfig.openaiOrgId && {
          "OpenAI-Organization": serverConfig.openaiOrgId,
        }),
      };
  const fetchOptions: RequestInit = {
    headers,
    method: req.method,
    body: req.body,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  // #1815 try to refuse gpt4 request
  if (serverConfig.customModels && req.body) {
    try {
      const modelTable = collectModelTable(
        DEFAULT_MODELS,
        serverConfig.customModels,
      );
      const clonedBody = await req.text();
      fetchOptions.body = clonedBody;

      const jsonBody = JSON.parse(clonedBody) as { model?: string };

      // not undefined and is false
      if (modelTable[jsonBody?.model ?? ""].available === false) {
        return NextResponse.json(
          {
            error: true,
            message: `you are not allowed to use ${jsonBody?.model} model`,
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {
      console.error("[OpenAI] gpt4 filter", e);
    }
  }

  try {
    const res = await fetch(fetchUrl, fetchOptions);

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export const checkAndGeToken = async () => {
  if (accessToken.expire > Date.now()) {
    return accessToken.token;
  }
  const token = await getCopilotV2Token(process.env.COPILOT_TOKEN);
  accessToken.token = token;
  accessToken.expire = Date.now() + 1000 * 20 * 60;
  return accessToken.token;
};

export const getCopilotV2Token = async (copilotToken: string | any) => {
  if (!copilotToken) return;
  const headers = {
    Host: "api.github.com",
    authorization: `token ${copilotToken}`,
    "Editor-Version": "vscode/1.85.0",
    "Editor-Plugin-Version": "copilot-chat/0.11.1",
    "User-Agent": "GitHubCopilotChat/0.11.1",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br",
  };
  const response = await fetch(
    "https://api.github.com/copilot_internal/v2/token",
    { headers },
  );
  const responseJson = await response.json();
  return responseJson["token"];
};
