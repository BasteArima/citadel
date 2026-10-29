# Citadel

Платформа учебных курсов, где каждая тема объясняется через «почему»: короткие части, анимации механики, задания руками и честные отметки о прохождении. Курсы правят админ в редакторе и ИИ-агенты через API.

Статус: этап 2 — вход по коду, база SQLite, прогресс на сервере. План — [docs/dev/ROADMAP.md](docs/dev/ROADMAP.md).

## Запуск

Нужны Go 1.27 и [Task](https://taskfile.dev) (`go install github.com/go-task/task/v3/cmd/task@latest`). Скопируй `.env.example` в `.env` и впиши код доступа.

```
task run      # сервер на http://localhost:8081, база в ./data
task up       # Docker Desktop, http://localhost:8080, база в томе
task backup   # бэкап базы из контейнера в ./backups
task verify   # формат, vet, тесты, проверка курсов
```

Поднять у себя с доменом — [docs/guides/self-hosting.md](docs/guides/self-hosting.md).

- Для разработчиков и агентов: [AGENTS.md](AGENTS.md), [docs/dev/](docs/dev/)
- Гайды: [docs/guides/](docs/guides/)
