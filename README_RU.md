# Scarlet Frontier Log v0.4

Пробная сетевая версия Owlbear Rodeo extension.

## Что изменилось в v0.4

- `index.html` теперь подключает `style.css?v=040` и `main.js?v=040`, чтобы Owlbear не хватал старый кэш.
- `manifest.json` указывает на `index.html?v=040`.
- Кнопка «Войти» сразу пишет событие в ленту и переключает на вкладку «Лента ↑».
- Событие сначала пишется локально, потом отправляется другим через Broadcast. Поэтому кнопка не выглядит «мертвой», даже если Broadcast капризничает.
- Лента по-прежнему показывает новые события сверху.

## Как обновить GitHub

Загрузи в репозиторий Scarlet_Log именно эти файлы из папки архива:

- manifest.json
- index.html
- style.css
- main.js
- icon.svg
- README_RU.md

После обновления проверь:

https://svenswanrig-netizen.github.io/Scarlet_Log/manifest.json

Там должна быть версия 0.4.0.

## Ссылка для Owlbear

https://svenswanrig-netizen.github.io/Scarlet_Log/manifest.json?v=040

Если расширение уже установлено, обычно достаточно обновить файлы и перезагрузить комнату. Если не подтягивается — удали расширение и добавь по ссылке выше.
