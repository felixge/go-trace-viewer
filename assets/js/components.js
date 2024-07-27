import { h, render, Component } from 'preact';
import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { goroutineTimeline } from './fake.js';
import htm from 'htm';
const html = htm.bind(h);

export function App() {
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
            groups: [{
                spans: goroutine.events.map((event) => ({
                    start: event.start,
                    end: event.end,
                    color: stateColor(event.state),
                })),
            }]
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


export function CanvasLane({groups, viewport}) {
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
        const firstSpan = groups[0].spans[0];
        const lastSpan = groups[groups.length-1].spans[groups[groups.length-1].spans.length-1];
        const [x, y, w, h] = [viewport.x(firstSpan.start), 0, viewport.width(lastSpan.end-firstSpan.start), height];
        ctx.fillStyle = mainColor;
        ctx.fillRect(x, y, w, h);

        let count = 0;
        groups.forEach(({spans}) => {
            spans
                .filter((span) => span.end >= viewport.start && span.start <= viewport.end && span.color !== mainColor)
                .forEach((span) => {
                    ctx.fillStyle = span.color;
                    const [x, y, w, h] = [viewport.x(span.start), 0, viewport.width(span.end-span.start), height];
                    ctx.fillRect(x, y, w, h);
                    count++;
                });
        });
    }, [groups, viewport]);
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
function useKeyboard(onKeysPressed) {
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
    }, []);
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
      const deltaTime = time - previousTimeRef.current;
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