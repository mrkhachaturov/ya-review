# ya-review (`yarev`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)

[English](README.md) | **Русский**

CLI-инструмент для сбора, хранения и анализа отзывов с Яндекс Карт с AI-классификацией по темам.

Отслеживайте отзывы о своём бизнесе и конкурентах, храните в SQLite, классифицируйте по темам с помощью OpenAI-эмбеддингов и оценивайте качество по направлениям. Вывод в JSON по умолчанию при перенаправлении — удобно для интеграции с AI и скриптами.

## Требования

- Node.js >= 22
- Один из: [Patchright](https://github.com/nicedayfor/patchright) (по умолчанию), Playwright или удалённый CDP-браузер
- OpenAI API-ключ (для AI-функций: эмбеддинги, классификация, скоринг)

## Установка

```bash
npm install
yarev init  # создаёт базу данных + устанавливает браузер
```

## Быстрый старт

```bash
# Добавить свою компанию
yarev track <org_id> --role mine --name "Мой Бизнес"

# Добавить конкурента
yarev track <competitor_id> --role competitor --name "Конкурент"
yarev competitor add --org <org_id> --competitor <competitor_id>

# Собрать отзывы (первый запуск = полный, далее = инкрементальный)
yarev sync --org <org_id> --full
yarev sync  # синхронизировать все компании

# Обзор статистики
yarev stats <org_id>

# Анализ отзывов
yarev digest <org_id> --stars 1-3 --limit 10    # негативные отзывы кратко
yarev search "дорого"                               # поиск по тексту
yarev trends <org_id>                             # динамика по месяцам
yarev unanswered <org_id> --stars 1-3             # без ответа бизнеса

# Сравнение с конкурентами
yarev compare --org <org_id>

# AI-анализ по темам (требуется YAREV_OPENAI_API_KEY)
yarev apply                                      # синхронизировать config.yaml → БД
yarev embed <org_id>                             # сгенерировать эмбеддинги
yarev classify <org_id>                          # распределить отзывы по темам
yarev topics <org_id>                            # темы с количеством и средней оценкой
yarev score <org_id>                             # AI-оценка качества по темам
yarev score --compare org1,org2                  # сравнение двух компаний
yarev similar --text "долго ждать"               # семантический поиск похожих отзывов

# Полные данные и произвольный SQL
yarev reviews <org_id> --stars 1-3 --since 2025-01-01
yarev query "SELECT COUNT(*) as cnt FROM reviews WHERE stars >= 4"
```

## Команды

### Настройка и отслеживание

| Команда | Описание |
|---------|----------|
| `init` | Инициализация БД и установка браузера |
| `track <org_id>` | Начать отслеживание (`--role mine\|competitor`) |
| `untrack <org_id>` | Прекратить отслеживание и удалить данные |
| `companies` | Список отслеживаемых компаний |
| `competitor add\|rm\|list` | Управление связями с конкурентами |

### Сбор данных

| Команда | Описание |
|---------|----------|
| `sync` | Собрать отзывы (`--org`, `--full`) |
| `status` | Статус синхронизации |
| `daemon` | Планировщик по cron (`--cron`) |

### Запросы и анализ

| Команда | Описание |
|---------|----------|
| `reviews <org_id>` | Полные данные отзывов (`--since`, `--stars`, `--limit`) |
| `stats <org_id>` | Распределение звёзд, % ответов, средние значения |
| `digest <org_id>` | Компактный список — дата/звёзды/текст |
| `search <text>` | Полнотекстовый поиск по всем отзывам (`--org`) |
| `trends <org_id>` | Количество отзывов и рейтинг по месяцам/неделям/кварталам |
| `unanswered <org_id>` | Отзывы без ответа бизнеса |
| `compare --org <id>` | Сравнение с конкурентами |
| `query <sql>` | Произвольный SQL-запрос (возвращает JSON) |

### AI и эмбеддинги

Требуется `YAREV_OPENAI_API_KEY` и `config.yaml` с определением тем. См. [config.example.ru.yaml](config.example.ru.yaml). Как работает скоринг: [Алгоритм скоринга](docs/scoring-algorithm.ru.md).

| Команда | Описание |
|---------|----------|
| `apply` | Синхронизация YAML-конфига в БД (компании, темы, связи) |
| `embed <org_id>` | Генерация OpenAI-эмбеддингов для отзывов и тем |
| `classify <org_id>` | Распределение отзывов по темам (по близости эмбеддингов) |
| `topics <org_id>` | Иерархия тем с количеством отзывов и средними звёздами |
| `similar` | Семантический поиск похожих отзывов (`--text` или `--review`) |
| `score <org_id>` | AI-оценка качества по темам (`--full`, `--compare`, `--refresh`) |

### Рабочий процесс AI-анализа

```bash
# 1. Настроить переменные окружения
export YAREV_OPENAI_API_KEY=sk-...

# 2. Создать config.yaml с темами (см. config.example.ru.yaml)
cp config.example.ru.yaml ~/.yarev/config.yaml
# отредактировать org_id и темы под ваш бизнес

# 3. Применить конфиг
yarev apply

# 4. Сгенерировать эмбеддинги
yarev embed <org_id>

# 5. Классифицировать отзывы
yarev classify <org_id>

# 6. Посмотреть результаты
yarev topics <org_id>
yarev score <org_id> --full
```

## Вывод

Все команды поддерживают флаг `--json`. При перенаправлении вывода (не TTY) JSON используется автоматически — удобно для интеграции с AI-инструментами и скриптами.

## Конфигурация

Переменные окружения (или `.env` файл):

| Переменная | По умолчанию | Описание |
|------------|-------------|----------|
| `YAREV_DB_URL` | — | Строка подключения PostgreSQL (если задана, используется PG) |
| `YAREV_DB_PATH` | `~/.yarev/reviews.db` | Путь к SQLite базе данных |
| `BROWSER_BACKEND` | `patchright` | `patchright`, `playwright` или `remote` |
| `BROWSER_WS_URL` | — | WebSocket URL для удалённого браузера |
| `BROWSER_HEADLESS` | `true` | Запуск браузера в headless-режиме |
| `MAX_PAGES` | `20` | Макс. страниц при полной синхронизации |
| `DAEMON_CRON` | `0 8 * * *` | Cron-расписание для демона |
| `YAREV_OPENAI_API_KEY` | — | OpenAI API-ключ (обязателен для эмбеддингов) |
| `YAREV_EMBEDDING_MODEL` | `text-embedding-3-small` | Модель эмбеддингов |
| `YAREV_CONFIG` | `~/.yarev/config.yaml` | Путь к YAML-конфигу |

См. [.env.example](.env.example) для полного списка.

## Разработка

```bash
npm run dev -- --help    # запуск через tsx
npm test                 # запуск тестов
npm run build            # сборка в dist/
```

## Лицензия

[MIT](LICENSE)
