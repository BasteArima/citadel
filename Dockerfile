# syntax=docker/dockerfile:1

# Сборка: один статический бинарник, фронтенд встроен в него.
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY web ./web
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/citadel ./cmd/citadel

# Запуск: бинарник и курсы, без компилятора и исходников.
FROM alpine:3.22
# edge-tts — синтез озвучки (решение 0015): Python-пакет в своём окружении, версия закреплена
RUN apk add --no-cache python3 && python3 -m venv /opt/edge-tts && \
    /opt/edge-tts/bin/pip install --no-cache-dir edge-tts==7.3.1 && \
    ln -s /opt/edge-tts/bin/edge-tts /usr/local/bin/edge-tts
RUN adduser -D -H -u 10001 citadel && mkdir -p /app/data && chown citadel /app/data
COPY --from=build /out/citadel /usr/local/bin/citadel
COPY content /app/content
WORKDIR /app
USER citadel
ENV CITADEL_ADDR=:8080 \
    CITADEL_CONTENT=/app/content \
    CITADEL_DATA=/app/data
VOLUME /app/data
EXPOSE 8080
ENTRYPOINT ["citadel", "serve"]
