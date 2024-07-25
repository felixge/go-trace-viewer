import { h, render, Component } from 'preact';
import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { goroutineTimeline } from './fake.js';
import htm from 'htm';
const html = htm.bind(h);

export function App() {
    return html`<${GoroutineTimeline} />`;
}

export function GoroutineTimeline() {
    const gt = goroutineTimeline();
    const sections = Object.values(gt.goroutines.reduce((acc, goroutine) => {
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
        start: gt.start,
        end: gt.end,
        sections: sections,
    };
    return html`<${Timeline} ...${timeline}}/>`;
}

export function Timeline({sections}) {
    const timelineRef = useRef(null);
    const timelineWidth = useRefWidth(timelineRef);
    const defaultViewport = {start: 0, end: 1000};
    const [viewport, setViewport] = useState(defaultViewport);

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
            (section) => html`<${Section} ...${{viewport}} ...${section} />`
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

// Lane is showing things happening over time on a single thread of execution.
export function Lane({groups, viewport}) {
    return html`<div class="lane">${
        groups.map((group) => html`<${FastGroup} ...${{viewport}} ...${group} />`)}
    </div>`;
}
class FastGroup extends Component {
    shouldComponentUpdate() {
        return false;
    }

    componentWillReceiveProps(nextProps) {
        this.renderProps(nextProps);
    }

    componentDidMount() {
        this.renderProps(this.props);
    }

    renderProps({spans, viewport}) {
        const start = spans[0].start;
        const end = spans[spans.length - 1].end;
        const renderedSpans = spans
            // Filter out spans that are outside the viewport
            .filter((span) => span.end >= viewport.start && span.start <= viewport.end)
            // Compute span style
            .map((span) => ({
                backgroundColor: span.color,
                left: viewport.x(span.start) - viewport.x(start),
                width: viewport.width(span.end - span.start),
            }))
            // Update or insert span
            .map((spanStyle, i) => {
                let span = this.base.children[i];
                if (!span) {
                    span = document.createElement('div');
                    span.className = 'span';
                    this.base.appendChild(span);
                }
                span.style.width = spanStyle.width + 'px';
                span.style.left = spanStyle.left + 'px';
                span.style.backgroundColor = spanStyle.backgroundColor;
                return true;
            });
    
        // Remove extra spans from this.base
        while (this.base.children.length > renderedSpans.length) {
            this.base.removeChild(this.base.children[this.base.children.length - 1]);
        }


        this.base.style.left = viewport.x(start)+'px';
        this.base.style.width = (viewport.x(end)-viewport.x(start))+'px';
        

        // console.log('renderProps', props);
        // let thing = document.createElement('maybe-a-custom-element');
        // this.base.appendChild(thing);
    }

    render() {
        return html`<div class="group" />`;
    }
}

// Group is a group of spans that belong together, e.g. to the same goroutine.
export function Group({spans, viewport}) {
    const start = spans[0].start;
    const end = spans[spans.length - 1].end;
    const style = {left: viewport.x(start), width: viewport.x(end)-viewport.x(start)}

    const spansHTML = html`${spans
        // Filter out spans that are outside the viewport
        .filter((span) => span.end >= viewport.start && span.start <= viewport.end)
        // Adjust the span positions to be relative to the group
        .map((span) => ({
            ...span,
            left: viewport.x(span.start) - viewport.x(start),
            width: viewport.width(span.end - span.start),
        }))
        // Render the spans
        .map((span) => html`<${Span} ...${span} />`)
    }`;

    return html`<div class="group" style=${style}>
        ${spansHTML}
    </div>`;
}

// Span is a single rectangle in the timeline.
export function Span({color, left, width, zoomHint, tooltip, onClick}) {
    const [tooltipComponent, setTooltipComponent] = useState(undefined);
    const style = {
        backgroundColor: color,
        left: left,
        width: width,
    }
    const zoomIcon = zoomHint ? html`<div class="zoom-icon">🔍</div>` : null;
    // const onMouseEnter = () => setShowTooltip(true);
    const onMouseMove = (e) => setTooltipComponent(tooltip && tooltip({left: e.clientX+10, top: e.clientY+10}));
    const onMouseLeave = () => setTooltipComponent(undefined);

    return html`<div
        class="span"
        onMouseLeave=${onMouseLeave}
        onMouseMove=${onMouseMove}
        style="${style}">
        ${zoomIcon}
        ${tooltipComponent}
    </div>`;
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
        case 'unscheduled': return '#ffadad';
        case 'waiting': return '#dddddd';
        case 'syscall': return '#fdffb6';
        default: return 'red';
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

    // // Check for zoom to change
    // let lastPixelRatio = 0;
    // const checkZoom = () => {
    //     const currentPixelRatio = window.devicePixelRatio;
    //     if (currentPixelRatio !== lastPixelRatio) {
    //         lastPixelRatio = currentPixelRatio;
    //         viewport.width = groupsDiv.offsetWidth-1;
    //         render();
    //     }
    //     requestAnimationFrame(checkZoom);
    // }
    // checkZoom();

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