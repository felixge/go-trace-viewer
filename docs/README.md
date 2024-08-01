# Docs


Stream
File

```
batch = {
    start
    end
    events
    goroutines: {
        [id]: [
            name, // string reference
            [timestamp, ...] // delta encoded, starting with generation start
            [state, ...] // strings reference
            // TODO: Stack traces, go create, etc.
        ]
    }
    stacks: [[func, file, line], ...] // func and file are string references
    strings: [string, ...]
}

timeline = {
    start
    end
    batches: [batch, ...]
}

viewport = {
    width
    height
}

view = {
    start
    end
}
```