# Как поднять Citadel у себя

Citadel — одна программа в Docker-контейнере. Данные (курсы с версиями, пользователи, прогресс) лежат в одном файле SQLite в Docker-томе.

## Что нужно

- Docker с Compose (Docker Desktop на Windows и macOS или Docker Engine на Linux).
- Для удобства — [Task](https://taskfile.dev): `go install github.com/go-task/task/v3/cmd/task@latest`. Без него все команды ниже есть и в «сыром» виде.

## Первый запуск

1. Склонируй репозиторий и перейди в папку.
2. Скопируй `.env.example` в `.env` и впиши:
   - `CITADEL_ACCESS_CODE` — код доступа к сервису. Его вводят при входе вместе с именем. Длинный и случайный: кто знает код, тот может войти под любым именем.
   - `CITADEL_ADMINS` — имена с правами админа через запятую.
3. Подними:
   ```
   task up
   ```
   или `docker compose up -d --build`.
4. Открой `http://localhost:8080`, введи имя и код.

При первом входе с новым именем создаётся пользователь. Имя не чувствительно к регистру: «Baste» и «baste» — один человек.

## Домен через Nginx Proxy Manager

1. В Nginx Proxy Manager: **Hosts → Proxy Hosts → Add Proxy Host**.
2. Domain Names — твой домен, Scheme — `http`, Forward Hostname — адрес машины с контейнером, Forward Port — `8080`.
3. На вкладке SSL выпусти сертификат Let's Encrypt, включи **Force SSL** и **HTTP/2**.

Nginx Proxy Manager передаёт заголовок `X-Forwarded-Proto: https`. По нему Citadel ставит сессионной cookie флаг `Secure`, и она ходит только по HTTPS.

Если NPM и Citadel на одной машине в Docker, можно не открывать порт наружу: убери `ports` из `compose.yaml`, подключи контейнер к сети NPM и укажи в Forward Hostname имя контейнера `citadel`.

## Обновление

```
git pull
task up
```

При запуске сервер сверяет курсы из `content/` с базой. Изменившийся курс становится новой опубликованной версией, прежние остаются в истории. Прогресс учеников не трогается: он хранится по id вопросов, а id не меняются.

## Бэкап

```
task backup
```

Копия базы появится в `backups/citadel-<дата>.db`. Её можно делать на ходу: копию пишет сам SQLite (`VACUUM INTO`), поэтому запись, которая идёт в этот момент, не испортит копию. Простое копирование файла базы во время работы так не умеет.

Без Task:

```
docker compose exec citadel citadel backup -out /app/data/backup.db
docker compose cp citadel:/app/data/backup.db backups/backup.db
docker compose exec citadel rm /app/data/backup.db
```

Храни бэкапы не только на той же машине.

## Восстановление из бэкапа

```
docker compose down
docker run --rm -v citadel_citadel-data:/data -v "$PWD/backups:/b:ro" alpine sh -c "rm -f /data/citadel.db-wal /data/citadel.db-shm && cp /b/<файл>.db /data/citadel.db && chown 10001 /data/citadel.db"
docker compose up -d
```

`citadel_citadel-data` — имя тома: папка проекта плюс `citadel-data`. Если папка называется иначе, посмотри имя в `docker volume ls`. `chown 10001` нужен потому, что программа в контейнере работает не от root.

## Сменить код доступа

Поменяй `CITADEL_ACCESS_CODE` в `.env` и выполни `docker compose up -d`. Новый код нужен для новых входов. Уже вошедшие остаются в системе, пока не выйдут или пока не истечёт сессия (до 180 дней при «Запомнить на этом устройстве», иначе сутки).

## Логи и проверка

```
task logs
```

`GET /healthz` отвечает `ok`, когда сервер работает. По нему же Docker помечает контейнер как healthy. После 10 неудачных попыток входа с одного адреса вход с него закрывается на 10 минут.
