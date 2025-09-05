import express from "express";
import dns from "dns";
import { Socket } from "net";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

function checkSMTP(email) {
  return new Promise((resolve) => {
    const domain = email.split("@")[1];
    if (!domain) return resolve({ email, status: "invalid", reason: "no domain" });

    dns.resolveMx(domain, (err, addresses) => {
      if (err || !addresses.length) {
        return resolve({ email, status: "invalid", reason: "no MX record" });
      }

      const mx = addresses.sort((a, b) => a.priority - b.priority)[0].exchange;
      const socket = new Socket();
      let step = 0;
      let verified = false;
      socket.setEncoding("ascii");

      socket.connect(25, mx);

      socket.on("data", (data) => {
        step++;
        if (step === 1) socket.write("HELO test.com\r\n");
        else if (step === 2) socket.write("MAIL FROM:<check@test.com>\r\n");
        else if (step === 3) socket.write(`RCPT TO:<${email}>\r\n`);
        else if (step === 4) {
          if (data.startsWith("250")) verified = true;
          socket.write("QUIT\r\n");
          socket.end();
        }
      });

      socket.on("end", () => {
        resolve({
          email,
          status: verified ? "valid" : "invalid",
          reason: verified ? "mailbox exists" : "mailbox rejected"
        });
      });

      socket.on("error", () => {
        resolve({ email, status: "unknown", reason: "SMTP connection failed" });
      });
    });
  });
}

app.post("/verify-smtp-bulk", async (req, res) => {
  const { emails } = req.body;
  if (!emails || !Array.isArray(emails) || emails.length === 0)
    return res.status(400).json({ error: "Missing emails array" });

  const concurrency = 5; // safe batch size
  const results = [];
  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(e => checkSMTP(e)));
    results.push(...batchResults);
  }

  res.json(results);
});

app.listen(3000, () => console.log("✅ Bulk SMTP verifier running on http://localhost:3000"));
