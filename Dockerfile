# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS web
WORKDIR /src/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.27-bookworm AS go
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY web/embed.go web/
COPY --from=web /src/web/dist/ web/dist/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/webedit ./cmd/webedit

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go /out/webedit /webedit
USER nonroot:nonroot
ENV PORT=5000
EXPOSE 5000
ENTRYPOINT ["/webedit"]
