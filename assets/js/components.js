import { h, render, Component } from 'preact';
import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

export function App() {
    const timeline = useTimeline();
    const [viewport, setViewport] = useState({
        start: 0,
        end: 10000 * 1e6,
        top: 0,
        auto: true,
    });

    if (viewport.auto) {
        viewport.start = timeline.start;
        viewport.end = timeline.end;
    }

    if (timeline.batches.length === 0) {
        return html`<div>Loading...</div>`;
    }

    const laneHeight = 9;
    const laneMarginBottom = 1;
    const fullLaneHeight = laneHeight + laneMarginBottom;

    const draw = ({ctx, x, y, width, height, totalWidth, totalHeight}) => {
        ctx.clearRect(0, 0, width, height);

        const laneRange = [
            Math.floor(y / fullLaneHeight),
            Math.ceil((y + height) / fullLaneHeight),
        ];
        const renderRange = [
            Math.floor(x / totalWidth * (timeline.end - timeline.start) + timeline.start),
            Math.ceil((x + width) / totalWidth * (timeline.end - timeline.start) + timeline.start),
        ];
        
        let count = 0;
        timeline.batches
            .forEach((batch, batchI) => {
                const nextBatch = timeline.batches[batchI+1];
                if (!overlap(batch.start, batch.end, renderRange[0], renderRange[1])
                    && (!nextBatch || !overlap(nextBatch.start, nextBatch.end, renderRange[0], renderRange[1]))
                ) {
                    return;
                }

                timeline.groups.slice(laneRange[0], laneRange[1])
                    .forEach(({goroutines: [goID]}, relI) => {
                        if (!(goID in batch.goroutines)) {
                            return;
                        }

                        const i = relI + laneRange[0];
                        // let startTs = batch.start;
                        const events = batch.goroutines[goID].events;
                        events.forEach((event, ei) => {
                            const nextEvent = (ei < events.length-1)
                                ? events[ei+1]
                                : timeline.batches[batchI+1]?.goroutines[goID]?.events[0];
                            if (!nextEvent) {
                                return;
                            }

                            // TODO: renable delta encoding
                            // startTs += event[0];
                            // const endTs = startTs + events[ei+1][0];
                            const startTs = event[0];
                            const endTs = nextEvent[0];
                            if (!overlap(startTs, endTs, renderRange[0], renderRange[1])) {
                                // return;
                            }

                            const rect = {
                                y: i * fullLaneHeight - y,
                                x: (startTs - timeline.start) / (timeline.end - timeline.start) * totalWidth - x,
                                height: laneHeight,
                                width: (endTs - startTs) / (timeline.end - timeline.start) * totalWidth,
                            };
                            const state = batch.strings[event[1]];
                            ctx.fillStyle = stateColor(state);
                            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
                            count++;
                        });
                    });

                // Set the line properties
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 1;
                const batchX = (batch.start - timeline.start) / (timeline.end - timeline.start) * totalWidth - x;
                // Draw the vertical line
                ctx.beginPath();
                ctx.moveTo(batchX, 0);
                ctx.lineTo(batchX, height);
                ctx.stroke();
            });
        console.log(count);
    };

    const totalSize = ({width, height}) => ({
        width: width * (timeline.end - timeline.start) / (viewport.end - viewport.start),
        height: timeline.groups.length*fullLaneHeight,
    });

    const [sortBy, setSortBy] = useState('start');
    const handleSortByChange = (e) => setSortBy(e.target.value);
    sortTimeline(sortBy, timeline);

    const [groupBy, setGroupBy] = useState('name');
    const handleGroupByChange = (e) => setGroupBy(e.target.value);

    const [compact, setCompact] = useState(false);
    const handleCompactChange = (e) => setCompact(e.target.checked);

    const [bucket, setBucket] = useState(true);
    const handleBucketChange = (e) => setBucket(e.target.checked);

    return html`<div class="container">
        <div class="bar">
            <${Select} label="Sort by" value=${sortBy} options=${[
                {value: "start", label: "Goroutine Start"},
                {value: "duration", label: "Goroutine Duration"},
                {value: "running", label: "Goroutine Running"},
            ]} onChange=${handleSortByChange} />
            <${Select} label="Group by" value=${groupBy} options=${[
                {value: "name", label: "Goroutine Name"},
                {value: "id", label: "Goroutine ID"},
            ]} onChange=${handleGroupByChange} />
            <${Checkbox} label="Compact" checked=${compact} onChange=${handleCompactChange} />
            <${Checkbox} label="Bucket" checked=${bucket} onChange=${handleBucketChange} />
        </div>
        <${Viewport} draw=${draw} totalSize=${totalSize} />
    </div>`;
}

const Checkbox = ({ label, checked, onChange }) => {
    return html`
        <label>
            <input type="checkbox" checked=${checked} onChange=${onChange} />
            ${label}
        </label>
    `;
};

const Select = ({ label, value, options, onChange }) => {
  return html`
    <label>
      ${label}
      <select value=${value} onChange=${onChange}>
        ${options.map((option) => (
          html`<option value=${option.value}>${option.label}</option>`
        ))}
      </select>
    </label>
  `;
};

function sortTimeline(sortBy, timeline) {
    switch (sortBy) {
        case 'start':
            timeline.groups.sort((a, b) => {
                const aStart = Math.min(...a.goroutines.map(goID => timeline.goroutines[goID].start));
                const bStart = Math.min(...b.goroutines.map(goID => timeline.goroutines[goID].start));
                return aStart - bStart;
            });
            break;
        case 'running':
            timeline.groups.sort((a, b) => {
                const aRunning = a.goroutines.reduce((sum, goID) => sum + timeline.goroutines[goID].running, 0);
                const bRunning = b.goroutines.reduce((sum, goID) => sum + timeline.goroutines[goID].running, 0);
                return bRunning - aRunning;
            });
            break;
        case 'duration':
            timeline.groups.sort((a, b) => {
                const aDuration = Math.max(...a.goroutines.map(goID => (timeline.goroutines[goID].end - timeline.goroutines[goID].start)));
                const bDuration = Math.max(...b.goroutines.map(goID => (timeline.goroutines[goID].end - timeline.goroutines[goID].start)));
                return bDuration - aDuration;
            });
            break;
    }
}

function overlap(start1, end1, start2, end2) {
    return start1 <= end2 && end1 >= start2;
}

function useTimeline() {
    const [timeline, setTimeline] = useState({
        start: 0,
        end: 0,
        eof: false,
        goroutines: {},
        groups: [],
        batches: [],
    });

    useEffect(async () => {
        if (timeline.eof) {
            return;
        }

        const res = await fetch(`/goroutines.json?start=${timeline.end}`)
        if (res.status === 404) {
            setTimeline(timeline => ({
                ...timeline,
                eof: true,
            }));
            return
        }
        const batch = await res.json();
        setTimeline(timeline => timelineAddBatch(timeline, batch));
    }, [timeline]);
    return timeline;
}

function timelineAddBatch(timeline, batch) {
    const newTimeline = {
        ...timeline,
        start: timeline.start || batch.start,
        end: Math.max(timeline.end, batch.end),
        batches: [...timeline.batches, batch],
    };

    Object.entries(batch.goroutines)
        .forEach(([goID, goroutine]) => {
            let g = timeline.goroutines[goID];
            if (!g) {
                g = {
                    start: Infinity,
                    end: 0,
                    running: 0,
                }
                timeline.goroutines[goID] = g;
                timeline.groups.push({
                    name: batch.strings[goroutine.name],
                    goroutines: [goID]
                });
            }
            g.running += goroutine.running;
            g.start = Math.min(g.start, goroutine.events[0][0]);
            g.end = Math.max(g.end, goroutine.events[goroutine.events.length-1][0]);
        });

    return newTimeline;
}

export function Viewport({draw, totalSize}) {
    const [scroll, setScroll] = useState({x: 0, y: 0});
    const [viewportSize, setViewportSize] = useState({width: 0, height: 0});
    const {width: totalWidth, height: totalHeight} = totalSize(viewportSize);
    // console.log('totalWidth', totalWidth, 'totalHeight', totalHeight);
    const canvasStyle = {
        marginLeft: `${scroll.x}px`,
        marginTop: `${scroll.y}px`,
        marginRight: `${totalWidth - viewportSize.width - scroll.x}px`,
        marginBottom: `${totalHeight - viewportSize.height - scroll.y}px`
    };
    const viewportRef = useRef(null);
    const canvasRef = useRef(null);

    useLayoutEffect(() => {
        const viewportElement = viewportRef.current;
        const onResize = () => setViewportSize({width: viewportElement.offsetWidth, height: viewportElement.offsetHeight});
        const onScroll = (e) => {
            e.preventDefault();
            e.stopPropagation();
            setScroll({x: viewportElement.scrollLeft, y: viewportElement.scrollTop});
        };
        viewportElement.addEventListener('scroll', onScroll);
        window.addEventListener('resize', onResize);
        onResize();

        return () => {
            window.removeEventListener('resize', onResize);
            viewportElement.removeEventListener('scroll', onScroll);
        }
    }, []);


    useLayoutEffect(() => {
        const ctx = canvasRef.current.getContext('2d');
        draw({
            ctx,
            x: scroll.x,
            y: scroll.y,
            width: viewportSize.width,
            height: viewportSize.height,
            totalWidth,
            totalHeight
        });
    }, [scroll, viewportSize, draw]);

    useKeyboard(({keys, dt}) => setScroll(scroll => {
        // speed is 50% of the current viewport size per second
        const speed = (viewportSize.width * 0.5) * dt / 1000;
        scroll = {...scroll};
        if (keys.has('a')) {
            scroll.x -= speed;
        }
        if (keys.has('d')) {
            scroll.x += speed;
        }
        scroll.x = Math.max(0, Math.min(scroll.x, totalWidth-viewportSize.width));
        scroll.y = Math.max(0, Math.min(scroll.y, totalHeight-viewportSize.height));

        return scroll;
    }), [viewportSize]);

    return html`<div ref=${viewportRef} scrollLeft=${scroll.x} scrollTop=${scroll.y} class="viewport">
        <canvas width=${viewportSize.width} height=${viewportSize.height} ref=${canvasRef} style=${canvasStyle} />
    </div>`;
}

// useKeyboard is a hook that calls onKeysPressed with the set of keys that are
// currently pressed every frame.
function useKeyboard(onKeysPressed, deps) {
    useLayoutEffect(() => {
        let keys = new Set();
        const onKeydown = (e) => keys.add(e.key);
        const onKeyup = (e) => keys.delete(e.key);
       
        let frameID;
        let prevTime;
        const onFrame = (t) => {
            frameID = window.requestAnimationFrame(onFrame);
            if (keys.size > 0) {
                const dt = prevTime ? t - prevTime : 0;
                onKeysPressed({keys, dt});
            }
            prevTime = t;
        }
        onFrame();
        window.addEventListener('keydown', onKeydown);
        window.addEventListener('keyup', onKeyup);

        return () => {
            window.removeEventListener('keydown', onKeydown);
            window.removeEventListener('keyup', onKeyup);
            window.cancelAnimationFrame(frameID);
        };
    }, deps);
}

function stateColor(state) {
    switch (state) {
        case 'running': return '#a0c4ff';
        case 'runnable': return '#ffadad';
        case 'waiting': return '#dddddd';
        case 'notexist': return '#dddddd';
        case 'syscall': return '#fdffb6';
        default: throw state; // TODO: better handling?
    }
}