# Scarlet Frontier Log v0.3

Пробная сетевая версия для Owlbear Rodeo.

Что изменено в v0.3:

- Новые события в ленте показываются сверху, больше не нужно листать вниз.
- Синхронизация усилена: события уходят через `OBR.broadcast.sendMessage(..., { destination: "ALL" })`.
- Лог дополнительно дублируется в room metadata, а клиенты слушают `OBR.room.onMetadataChange`.
- Если broadcast не сработал, metadata всё равно должна подтянуть последние события.

Как обновить:

1. Распакуй архив.
2. Замени файлы в репозитории `Scarlet_Log`.
3. Проверь, что `https://svenswanrig-netizen.github.io/Scarlet_Log/manifest.json` показывает `"version": "0.3.0"`.
4. В Owlbear удали старое расширение и добавь заново:

```text
https://svenswanrig-netizen.github.io/Scarlet_Log/manifest.json?v=030
```

Проверка онлайна:

- Открой одну комнату Owlbear в двух браузерах или обычной вкладке + инкогнито.
- В обоих окнах открой Scarlet Log.
- Нажми «Войти» в обоих.
- Отправь сообщение или бросок в одном окне.
- Во втором оно должно появиться в ленте сверху.
