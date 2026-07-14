import "dotenv/config";
import cors from "cors";
import express, { ErrorRequestHandler } from "express";
import multer from "multer";
import authRouter from "./routes/auth";
import documentsRouter from "./routes/documents";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "heault-server" });
});

app.use("/api", authRouter);
app.use("/api", documentsRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "Uploaded file is too large. Maximum upload size is 15 MB." });
    return;
  }

  if (error?.type === "entity.too.large") {
    res.status(413).json({ error: "Request payload is too large. Maximum JSON payload size is 15 MB." });
    return;
  }

  res.status(500).json({ error: "Unexpected server error." });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Heault backend listening on port ${port}`);
});
