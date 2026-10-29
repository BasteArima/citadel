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
RUN adduser -D -H -u 10001 citadel
COPY --from=build /out/citadel /usr/local/bin/citadel
COPY content /app/content
WORKDIR /app
USER citadel
ENV CITADEL_ADDR=:8080 \
    CITADEL_CONTENT=/app/content
EXPOSE 8080
ENTRYPOINT ["citadel", "serve"]
