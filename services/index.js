const fastify = require('fastify')({ logger: true });
const listenMock = require('../mock-server');

const MAX_RETRIES = 3;
const ADD_EVENT_FAILURE_WINDOW_MS = 30_000;
const ADD_EVENT_FAILURE_THRESHOLD = 3;
const ADD_EVENT_BACKOFF_PROBE_INTERVAL = 15_000;

let addEventFailureTimestamps = [];
let addEventInDegradedMode = false;
let lastAddEventProbeTime = 0;

fastify.get('/getUsers', async (request, reply) => {
    const resp = await fetch('http://event.com/getUsers');
    const data = await resp.json();
    reply.send(data); 
});

fastify.post('/addEvent', async (request, reply) => {
  const now = Date.now();

  // Clean old failures
  addEventFailureTimestamps = addEventFailureTimestamps.filter(
    ts => now - ts < ADD_EVENT_FAILURE_WINDOW_MS
  );

  const isProbe = addEventInDegradedMode && (now - lastAddEventProbeTime >= ADD_EVENT_BACKOFF_PROBE_INTERVAL);

  if (addEventInDegradedMode && !isProbe) {
    return reply.status(503).send({ error: 'AddEvent service temporarily unavailable. Please try again later.' });
  }
  const body = JSON.parse(request.body);
  
  try {
    // If we're probing, we want to use the fetch function directly
    const fetchFn = isProbe ? fetch : fetchWithRetry;
    const resp = await fetchFn('http://event.com/addEvent', {
      method: 'POST',
      body: JSON.stringify({
        id: new Date().getTime(),
        ...body
      }, MAX_RETRIES, ADD_EVENT_BACKOFF_PROBE_INTERVAL)
    });
    
    if (resp.error) {
      throw new Error(`External addEvent failed: ${resp.statusText}`);
    }

    const data = await resp.json();

    if (isProbe) {
      fastify.log.info('addEvent probe successful — exiting degraded mode.');
    }

    addEventFailureTimestamps = [];
    addEventInDegradedMode = false;

    reply.send(data);

  } catch (err) {
    const ts = Date.now();
    addEventFailureTimestamps.push(ts);

    console.log(`What is going on.. ${err.message}`);

    if (!addEventInDegradedMode && addEventFailureTimestamps.length >= ADD_EVENT_FAILURE_THRESHOLD) {
      console.log('Entering degraded mode for addEvent route.');
      addEventInDegradedMode = true;
      lastAddEventProbeTime = ts;
      fastify.log.warn('addEvent route entered degraded mode.');
    }

    if (isProbe) {
      console.log('Probe failed, remaining in degraded mode.');
      lastAddEventProbeTime = ts;
      fastify.log.warn('addEvent probe failed — remaining in degraded mode.');
    }

    reply.status(503).send({ error: 'Unable to add event', detail: err.message });
  }
});

fastify.get('/getEvents', async (request, reply) => {  
    const resp = await fetchWithRetry('http://event.com/getEvents');
    const data = await resp.json();
    reply.send(data);
});

// helper retry function...
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES, delay = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Optionally retry only on certain status codes
      if (!response.ok && response.status >= 500) {
        throw new Error(`Server error: ${response.status}`);
      }

      return response
    } catch (err) {
      if (attempt === retries) throw err

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
}

fastify.get('/getEventsByUserId/:id', async (request, reply) => {
    const { id } = request.params;
    const user = await fetch('http://event.com/getUserById/' + id);
    const userData = await user.json();
    const userEvents = userData.events;
    
    // Instead of awaiting on each request... let's use Promise.all to handle all of the event retrivals in parallel
    const eventPromises = userEvents.map(async eventId => {
      try {
        const eventResp = await fetch(`http://event.com/getEventById/${ eventId }`)

        if (eventResp.error) {
          throw new Error(`External getEventById failed: ${eventResp.statusText}`);
        }

        return await eventResp.json();
      } catch (err) {
        fastify.log.error(`Failed to fetch event ${eventId}: ${err.message}`);
        return null; // or handle the error as needed
      }
    });

    const events = await Promise.all(eventPromises);
    reply.send(events);
});

fastify.listen({ port: 3000 }, (err) => {
    listenMock();
    if (err) {
      fastify.log.error(err);
      process.exit();
    }
});
