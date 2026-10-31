# Как поднять Citadel у себя

Citadel — одна программа в Docker-контейнере. Данные (курсы с версиями, пользователи, прогресс) лежат в одном файле SQLite в Docker-томе. Рядом работают исполнитель кода курсов и прокси к Docker — см. «Запуск кода курсов».

## Что нужно

- Docker с Compose (Docker Desktop на Windows и macOS или Docker Engine на Linux).
- Для удобства — [Task](https://taskfile.dev): `go install github.com/go-task/task/v3/cmd/task@latest`. Без него все команды ниже есть и в «сыром» виде.

## Первый запуск

1. Склонируй репозиторий и перейди в папку.
2. Скопируй `.env.example` в `.env` и впиши:
   - `CITADEL_ACCESS_CODE` — код доступа к сервису. Его вводят при входе вместе с именем. Длинный и случайный: кто знает код, тот может войти под любым именем.
   - `CITADEL_ADMINS` — имена с правами админа через запятую.
   - `CITADEL_RUNNER_SECRET` — секрет между Citadel и исполнителем кода, не короче 24 символов. Сгенерировать: `openssl rand -base64 32`.
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

Это касается только курсов, которые ещё не правили в админке. Как только у курса появилась версия из редактора, файл из `content/` для него пропускается (в логе — `course file skipped`): иначе обновление сервиса затёрло бы правки. Новую версию из файла такого курса загружают в админке кнопкой «Импорт JSON» — она станет черновиком, и её публикуют после просмотра разницы.

## Админка

Админка — `/admin`, ссылка «Админка» видна в шапке у админов. Курс бывает публичным (его видят все вошедшие) и приватным (видят админы и те, кому ты выдал его в «Пользователях»); переключатель — в таблице «Курсы». Админы — имена из `CITADEL_ADMINS` (они админы при каждом входе) и те, кому роль дали на странице «Пользователи». Там же роль можно забрать; имена из `CITADEL_ADMINS` получат её обратно при следующем входе, так что совсем остаться без админа нельзя.

## Запуск кода курсов

Кнопка «Запустить на сервере» в редакторе, инструмент агента `run_code` и проверка выводов в правках агентов запускают код курса на сервере (решение `docs/dev/decisions/0013-running-course-code.md`). Каждый запуск — одноразовый контейнер без сети, без томов, под непривилегированным пользователем, с лимитами на память, процессы, процессор, диск, вывод и время. Запускать могут только админы и агенты, ученики — нет.

`task up` поднимает для этого три сервиса из `compose.yaml`:

- `runner` — исполнитель: получает от Citadel код и создаёт контейнер под запуск;
- `docker-proxy` — прокси к сокету Docker: пропускает только операции с контейнерами, всё остальное закрыто;
- `go-toolchain` — только скачивает образ `golang:1.27-alpine` и сразу выходит. Это нормально: сам исполнитель скачивать образы не может.

Без `CITADEL_RUNNER_SECRET` исполнитель не стартует, а Citadel работает как раньше — просто без кнопок запуска.

### gVisor на домашнем сервере (рекомендуется)

Контейнеры делят ядро с хостом, и уязвимость ядра теоретически может вывести код из контейнера. [gVisor](https://gvisor.dev) запускает контейнер со своим ядром в пространстве пользователя и закрывает этот путь. На Linux (Debian, Ubuntu) — по [официальной инструкции](https://gvisor.dev/docs/user_guide/install/):

```
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install
sudo systemctl reload docker
docker run --rm --runtime=runsc hello-world
```

Если последняя команда напечатала приветствие, впиши в `.env` строку `CITADEL_RUNNER_RUNTIME=runsc` и выполни `task up`. В логе исполнителя (`docker compose logs runner`) будет `"runtime":"runsc"`. На Docker Desktop под Windows gVisor недоступен — там Docker и так работает внутри виртуальной машины.

## Подключить агента

В админке, «Пользователи и токены» → «+ Новый токен»: название, права (читать, предлагать правки, создавать курсы) и курсы. После создания админка один раз покажет токен и готовую команду для Claude Code:

```
claude mcp add --scope user --transport http citadel https://<твой домен>/mcp --header "Authorization: Bearer cit_…"
```

Команда выполняется на ПК, где работает Claude Code. Агент получает инструменты Citadel: читать курсы и схему блоков, запускать код (`run_code`), проверять и отправлять правки, узнавать их статус. Публиковать он не может: правки приходят в «Правки агентов», принимаешь их в черновик и публикуешь ты. Токен в базе не хранится (только его хеш) — потерял, отзови и выпусти новый. Через Nginx Proxy Manager `/mcp` проходит как обычный адрес сайта, отдельных настроек не нужно.

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

Логи исполнителя кода — `docker compose logs runner`: по строке на запуск, с кодом выхода и временем, без самого кода. `GET /healthz` отвечает `ok`, когда сервер работает. По нему же Docker помечает контейнер как healthy. После 10 неудачных попыток входа с одного адреса вход с него закрывается на 10 минут.
