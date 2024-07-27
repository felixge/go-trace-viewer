import { Tooltip } from "./components.js";
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

export async function goroutineTimeline() {
    const random = seededRandom(1234);

    const timeline = {
        start: 0,
        end: 1000,
        goroutines: [
            {
                id: 1,
                name: 'main.main',
                events: [
                    {start: 0, end: 20, state: 'unscheduled'},
                    {start: 20, end: 100, state: 'running'},
                    {start: 100, end: 500, state: 'syscall'},
                    {start: 500, end: 510, state: 'running'},
                ]
            },
            {
                id: 2,
                name: 'net/http.ListenAndServe',
                events: [
                    {start: 50, end: 70, state: 'unscheduled'},
                    {start: 70, end: 130, state: 'running'},
                    {start: 130, end: 400, state: 'syscall'},
                    {start: 400, end: 405, state: 'running'},
                ]
            },
            {
                id: 3,
                name: 'net/http.ListenAndServe',
                events: [
                    {start: 50+20, end: 70+20, state: 'unscheduled'},
                    {start: 70+20, end: 130+20, state: 'running'},
                    {start: 130+20, end: 400+20, state: 'syscall'},
                    {start: 400+20, end: 405+20, state: 'running'},
                ]
            },
            {
                id: 4,
                name: 'net/http.ListenAndServe',
                events: generateGoroutineEvents(20, 0, 1000, random),
            },
        ],
    };
    for (let i = 0; i < 100; i++) {
        timeline.goroutines.push({
            id: timeline.goroutines.length + 1,
            name: 'net/http.ListenAndServe',
            events: generateGoroutineEvents(1000, 0, 1000, random),
        })
    }


    return timeline;
}

function generateGoroutineEvents(n = 50, start = 0, end = 1000, random) {
    const events = [];
    const avgDuration = (end - start) / n;
    let prevEnd = start;
    let prevState = null;
    for (let i = 0; i < n && prevEnd < end; i++) {
        const randDuration = exponentialRandom(avgDuration, random);
        const duration = (randDuration > end - prevEnd || i == n - 1)
            ? end - prevEnd :
            randDuration;

        const event = {
            start: prevEnd,
            end: prevEnd + duration,
            state: randomState(random, prevState),
        }
        events.push(event);
        prevEnd = event.end;
        prevState = event.state;
    }
    return events;
}

function exponentialRandom(mean, random) {
    return -mean * Math.log(1 - random());
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function randomState(random, currentState) {
    switch (currentState) {
        case 'running':
            const rand = random();
            if (rand < 0.1) {
                return 'syscall';
            } else if (rand < 0.2) {
                return 'unscheduled';
            } else {
                return 'waiting'
            }
        case 'syscall':
            return 'unscheduled';
        case 'unscheduled':
            return 'running';
        case 'waiting':
            return 'running';
        default:
            return 'unscheduled';
    }
}