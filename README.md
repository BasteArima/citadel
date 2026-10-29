# Citadel

Платформа учебных курсов, где каждая тема объясняется через «почему»: короткие части, анимации механики, задания руками и честные отметки о прохождении. Курсы правят админ в редакторе и ИИ-агенты через API.

Статус: этап 1, каркас. Сервер отдаёт Go-курс из формата v1. План — [docs/dev/ROADMAP.md](docs/dev/ROADMAP.md).

## Запуск

Нужны Go 1.27 и [Task](https://taskfile.dev) (`go install github.com/go-task/task/v3/cmd/task@latest`).

```
task run      # сервер на http://localhost:8081
task up       # Docker Desktop, http://localhost:8080
task verify   # формат, vet, тесты, проверка курсов
```

- Для разработчиков и агентов: [AGENTS.md](AGENTS.md), [docs/dev/](docs/dev/)
- Гайды: [docs/guides/](docs/guides/)
