import { h, render, Component } from 'preact';
import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { goroutineTimeline } from './fake.js';
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

export function OldApp2() {
    const rect = {x: 200, y: 450, width: 100, height: 150};
    const draw = ({ctx, x, y, width, height}) => {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'red';
        ctx.fillRect(rect.x - x, rect.y - y, rect.width, rect.height);
        ctx.fillStyle = 'blue';
        ctx.fillRect(10, 10, 50, 50);
    };
    return html`<div class="container">
        <div class="bar"><input type="text" /></div>
        <${Viewport} draw=${draw} totalWidth=${10000} totalHeight=${10000} />
    </div>`;
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

export function OldApp() {
    const [data, setData] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            let res, json;
            try {
                res = await fetch('/goroutines.json');
                json = await res.json();
            } catch (e) {
                throw('TODO: handle: '+e);
            }
            let maxTime = 0;
            const timeline = {
                start: 0,
                end: 0,
                goroutines: Object
                    .entries(json.goroutines)
                    .map(([goID, {name: nameSID, events}]) => ({
                        id: goID,
                        name: json.strings[nameSID],
                        events: events.slice(0, events.length-1).map((event, i) => {
                            const [start, stateSID] = event;
                            const [end] = events[i+1];
                            const state = json.strings[stateSID];
                            maxTime = Math.max(maxTime, end);
                            return {start, end, state}
                        }),
                    })),
            };
            timeline.end = maxTime;
            // timeline.goroutines = timeline.goroutines.slice(0, 1000);
            setData(timeline);
        };

        fetchData();
    }, []);
    if (data === null) {
        return html`<div>Loading...</div>`;
    }

    return html`<${GoroutineTimeline} data=${data} />`;
}

export function GoroutineTimeline({data}) {
    const sections = Object.values(data.goroutines.reduce((acc, goroutine) => {
        const lane = {
            spans: goroutine.events.map((event) => ({
                start: event.start,
                end: event.end,
                color: stateColor(event.state),
            })),
        }

        if (acc[goroutine.name]) {
            acc[goroutine.name].lanes.push(lane);
        } else {
            acc[goroutine.name] = {name: goroutine.name, lanes: [lane]};
        }
        return acc;
    }, {}));


    const timeline = {
        start: data.start,
        end: data.end,
        sections: sections,
    };
    return html`<${Timeline} ...${timeline}}/>`;
}

export function Timeline({start, end, sections}) {
    const timelineRef = useRef(null);
    const timelineWidth = useRefWidth(timelineRef);
    const defaultViewport = {start, end};
    const [viewport, setViewport] = useState(defaultViewport);
    const [scroll, setScroll] = useState(0);

    useEffect(() => {
        const onScroll = () => setViewport(vp => ({...vp, scrollY: window.scrollY}));
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, [])

    useKeyboard(({keys, dt}) => setViewport(vp => {
        // speed is 50% of the current viewport size per second
        const speed = ((vp.end - vp.start) * 0.5) * dt / 1000;
        if (keys.has('0')) {
            return defaultViewport;
        }
        vp = {...vp};
        if (keys.has('a')) {
            vp.start -= speed;
            vp.end -= speed;
        }
        if (keys.has('d')) {
            vp.start += speed;
            vp.end += speed;
        }
        if (keys.has('w')) {
            vp.start += speed;
            vp.end -= speed;
        }
        if (keys.has('s')) {
            vp.start -= speed;
            vp.end += speed;
        }
        return vp;
    }));

    viewport.x = (time) => timelineWidth * (time - viewport.start) / (viewport.end - viewport.start);;
    viewport.width = (duration) => duration * timelineWidth / (viewport.end - viewport.start);

    return html`<div ref=${timelineRef} class="timeline">
        <${TimeAxis} ...${{viewport}} />
        ${timelineWidth > 0 && sections.map(
            (section) => html`<${Section} ...${{viewport}} ...${section} ...${{scroll}} />`
        )}
    </div>`;
}

export function TimeAxis({viewport}) {
    const ticks = generateTimeTicks(viewport.start, viewport.end, viewport.width(viewport.end - viewport.start) / 130);
    
    return html`<div class="time-axis">
        ${ticks.ticks.map((tick) => {
            const style = {left: viewport.x(tick-ticks.interval), width: viewport.width(ticks.interval)};
            return html`<div class="tick" style=${style}>${tick} ms</div>`;
        })}
    </div>`;
}

// Section is a group of lanes that belong together, e.g. goroutines with the
// same gopc.
export function Section({name, lanes, viewport}) {
    const [expanded, setExpanded] = useState(true);
    const onClick = () => setExpanded(expanded => !expanded);

    return html`<div class="section">
        <div class="name"><span onClick=${onClick}>${expanded ? '▾' : '▸'} ${name}</span></div>
        ${expanded && lanes.map((lane) => html`<${CanvasLane} ...${{viewport}} ...${lane} />`)}
    </div>`;
}


export function CanvasLane({spans, viewport}) {
    const canvasRef = useRef(null);
    useLayoutEffect(() => {
        const {width, height} = canvasRef.current.getBoundingClientRect();
        if (!isElementInViewport(canvasRef.current)) {
            return;
        }

        canvasRef.current.width = width;
        canvasRef.current.height = height;
        const ctx = canvasRef.current.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        const mainColor = stateColor('running');
        const firstSpan = spans[0];
        const lastSpan = spans[spans.length-1];
        const [x, y, w, h] = [viewport.x(firstSpan.start), 0, viewport.width(lastSpan.end-firstSpan.start), height];
        ctx.fillStyle = mainColor;
        ctx.fillRect(x, y, w, h);

        let count = 0;
        spans
            .filter((span) => span.end >= viewport.start && span.start <= viewport.end && span.color !== mainColor)
            .forEach((span) => {
                ctx.fillStyle = span.color;
                const [x, y, w, h] = [viewport.x(span.start), 0, viewport.width(span.end-span.start), height];
                ctx.fillRect(x, y, w, h);
                count++;
            });
    }, [spans, viewport]);
    return html`<canvas ref=${canvasRef} class="lane" />`;
}

export function Tooltip({left, top, children}) {
    const style = {left: left+'px', top: top+'px'}
    return html`<div class="tooltip" style=${style}>
        ${children}
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

function useRefWidth(ref) {
    const [size, setSize] = useState(0);
    useLayoutEffect(() => {
        window.addEventListener('resize', () => setSize(ref.current.offsetWidth));
        setSize(ref.current.offsetWidth);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // check for zoom changes
    useAnimationFrame(() => setSize(ref.current.offsetWidth));

    return size;
}

const useAnimationFrame = callback => {
  const requestRef = useRef();
  const previousTimeRef = useRef();
  
  const animate = time => {
    if (previousTimeRef.current != undefined) {
      const Time = time - previousTimeRef.current;
      callback(deltaTime)
    }
    previousTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  }
  
  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, []);
}

function generateTimeTicks(minTime, maxTime, targetTickCount) {
  const timeRange = maxTime - minTime;
  const idealInterval = timeRange / targetTickCount;
  
  // Nice intervals in nanoseconds
  const intervals = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,  // nanoseconds
    1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000,  // microseconds
    1000000, 2000000, 5000000, 10000000, 20000000, 50000000, 100000000, 200000000, 500000000,  // milliseconds
    1000000000, 2000000000, 5000000000, 10000000000, 15000000000, 30000000000,  // seconds
    60000000000, 120000000000, 300000000000, 600000000000, 900000000000, 1800000000000,  // minutes
  ];
  
  // Convert input milliseconds to nanoseconds
  const minTimeNano = minTime * 1000000;
  const maxTimeNano = maxTime * 1000000;
  const idealIntervalNano = idealInterval * 1000000;
  
  // Find the closest nice interval
  const niceInterval = intervals.reduce((prev, curr) => 
    Math.abs(curr - idealIntervalNano) < Math.abs(prev - idealIntervalNano) ? curr : prev
  );
  
  // Adjust min and max to align with the interval
  const niceMin = Math.floor(minTimeNano / niceInterval) * niceInterval;
  const niceMax = Math.ceil(maxTimeNano / niceInterval) * niceInterval;
  
  // Generate tick values
  const ticks = [];
  const maxTickCount = 1000; // Limit the maximum number of ticks to prevent array overflow
  let tickCount = 0;
  for (let tick = niceMin; tick <= niceMax && tickCount < maxTickCount; tick += niceInterval) {
    ticks.push(tick / 1000000); // Convert back to milliseconds
    tickCount++;
  }
  
  return {
    ticks,
    interval: niceInterval / 1000000, // Convert back to milliseconds
    min: niceMin / 1000000, // Convert back to milliseconds
    max: niceMax / 1000000 // Convert back to milliseconds
  };
}

function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}