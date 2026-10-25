const CHARACTERS = [
  "Leon S. Kennedy",
  "Chris Redfield",
  "Jill Valentine",
  "Ada Wong",
  "Claire Redfield",
  "Sherry Birkin",
  "Rebecca Chambers",
  "Ethan Winters",
  "Barry Burton",
  "Luis Sera",
  "Albert Wesker",
  "HUNK",
  "Jack Krauser",
  "Alcina Dimitrescu",
  "Jack Baker",
  "Karl Heisenberg",
  "Oswell E. Spencer",
  "Ramón Salazar",
  "Zeno"
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: CORS
  });

const redirect = url => Response.redirect(url, 302);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return json({
        status: "Survival Protocol backend is online"
      });
    }

    // بدء تسجيل الدخول بواسطة Google
    if (url.pathname === "/auth" && request.method === "GET") {
      const state = crypto.randomUUID();

      await env.VOTES_KV.put(
        `oauthstate:${state}`,
        "1",
        { expirationTtl: 600 }
      );

      const google = new URL(
        "https://accounts.google.com/o/oauth2/v2/auth"
      );

      google.searchParams.set(
        "client_id",
        env.GOOGLE_CLIENT_ID
      );

      google.searchParams.set(
        "redirect_uri",
        env.REDIRECT_URI
      );

      google.searchParams.set("response_type", "code");

      google.searchParams.set(
        "scope",
        "https://www.googleapis.com/auth/youtube.readonly openid"
      );

      google.searchParams.set("state", state);
      google.searchParams.set("prompt", "select_account");
      google.searchParams.set("access_type", "online");

      return redirect(google.toString());
    }

    // استقبال رد Google والتحقق من الاشتراك
    if (
      url.pathname === "/oauth2callback" &&
      request.method === "GET"
    ) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (
        !code ||
        !state ||
        !await env.VOTES_KV.get(`oauthstate:${state}`)
      ) {
        return redirect(
          `${env.FRONTEND_URL}/?youtube=error`
        );
      }

      await env.VOTES_KV.delete(`oauthstate:${state}`);

      const tokenResponse = await fetch(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: env.REDIRECT_URI,
            grant_type: "authorization_code"
          })
        }
      );

      const tokenData = await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !tokenData.access_token
      ) {
        return redirect(
          `${env.FRONTEND_URL}/?youtube=error`
        );
      }

      // معرفة هوية حساب Google
      const identityResponse = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: {
            Authorization:
              `Bearer ${tokenData.access_token}`
          }
        }
      );

      if (!identityResponse.ok) {
        return redirect(
          `${env.FRONTEND_URL}/?youtube=error`
        );
      }

      const identity = await identityResponse.json();

      if (!identity.sub) {
        return redirect(
          `${env.FRONTEND_URL}/?youtube=error`
        );
      }

      // البحث عن حساب موثّق سابقاً
      const accountKey = `verified:${identity.sub}`;
      const savedAccount = await env.VOTES_KV.get(
        accountKey,
        "json"
      );

      let session;

      if (
        savedAccount &&
        savedAccount.verified === true &&
        savedAccount.token
      ) {
        // الحساب موثّق سابقاً، نعيد استخدام رمزه
        session = savedAccount.token;

        await env.VOTES_KV.put(
          `session:${session}`,
          JSON.stringify({
            verified: true,
            googleId: identity.sub
          })
        );
      } else {
        // التحقق من الاشتراك بالقناة لأول مرة
        const youtubeUrl = new URL(
          "https://www.googleapis.com/youtube/v3/subscriptions"
        );

        youtubeUrl.searchParams.set("part", "id");
        youtubeUrl.searchParams.set("mine", "true");

        youtubeUrl.searchParams.set(
          "forChannelId",
          env.YOUTUBE_CHANNEL_ID
        );

        youtubeUrl.searchParams.set(
          "maxResults",
          "1"
        );

        const youtubeResponse = await fetch(
          youtubeUrl,
          {
            headers: {
              Authorization:
                `Bearer ${tokenData.access_token}`
            }
          }
        );

        const youtubeData = await youtubeResponse.json();

if (!youtubeResponse.ok) {
  return new Response(
    JSON.stringify({
      error: "YouTube API request failed",
      status: youtubeResponse.status,
      details: youtubeData
    }),
    {
      status: 502,
      headers: CORS
    }
  );
}

        if (
          !Array.isArray(youtubeData.items) ||
          youtubeData.items.length === 0
        ) {
          return redirect(
            `${env.FRONTEND_URL}/?youtube=not_subscribed`
          );
        }

        // إنشاء رمز دائم للحساب الموثّق
        session = crypto.randomUUID();

        await env.VOTES_KV.put(
          accountKey,
          JSON.stringify({
            verified: true,
            token: session
          })
        );

        await env.VOTES_KV.put(
          `session:${session}`,
          JSON.stringify({
            verified: true,
            googleId: identity.sub
          })
        );
      }

      return redirect(
        `${env.FRONTEND_URL}/?youtube=verified&session=${encodeURIComponent(session)}`
      );
    }

    // جلب الأصوات الحالية من دون تغييرها
    if (
      url.pathname === "/votes" &&
      request.method === "GET"
    ) {
      const votes = {};

      for (const character of CHARACTERS) {
        votes[character] = Number(
          await env.VOTES_KV.get(`vote:${character}`) || 0
        );
      }

      return json(votes);
    }

    // تسجيل تصويت
    if (
      url.pathname === "/vote" &&
      request.method === "POST"
    ) {
      const authorization =
        request.headers.get("Authorization") || "";

      const session = authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";

      if (!session) {
        return json({
          success: false,
          error: "Google verification required"
        }, 401);
      }

      const sessionData = await env.VOTES_KV.get(
        `session:${session}`,
        "json"
      );

      if (
        !sessionData ||
        sessionData.verified !== true ||
        !sessionData.googleId
      ) {
        return json({
          success: false,
          error: "Google verification required"
        }, 401);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json({
          success: false,
          error: "Invalid JSON"
        }, 400);
      }

      if (!CHARACTERS.includes(body.character)) {
        return json({
          success: false,
          error: "Invalid character"
        }, 400);
      }

      const voteKey = `vote:${body.character}`;

      const currentVotes = Number(
        await env.VOTES_KV.get(voteKey) || 0
      );

      const newVotes = currentVotes + 1;

      await env.VOTES_KV.put(
        voteKey,
        String(newVotes)
      );

      // لا نحذف رمز الحساب بعد التصويت.
      // يسمح ذلك للحساب الموثّق بالتصويت مجدداً.

      return json({
        success: true,
        character: body.character,
        votes: newVotes
      });
    }

    return json({
      error: "Not found"
    }, 404);
  }
};
