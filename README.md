## Fastify Routes Summary

This is a fastify REST API that supports getting a list of users for a given event.
This is achieved by persisting users and events and using various tools to bind them together.

The public routes are as follows
### GET /getUsers
Fetches a list of users from an external service.

    * Makes a GET request to http://event.com/getUsers
    * Returns the parsed JSON response to the client
    
### POST /addEvent
Adds a new event by forwarding a request to an external service.

    * Generates a unique id using the current timestamp
    * Sends a POST request to http://event.com/addEvent with the request body and new id
    * Returns the response from the external service
    * Handles degraded mode functionality

### GET /getEvents
Fetches all events with built-in retry logic on failure.

    * Uses the fetchWithRetry helper (up to 3 retries with backoff)
    * Requests data from http://event.com/getEvents
    * Returns the events data
    * Detects when the external service is consistently failing (3+ failures within a 30-second window)
    * I was not able to get the gradual retry logic going in time. I'd probably clean it up by trying to use the helper method I had created using the falloffInterval...
    * Was close but not complete :(

### GET /getEventsByUserId/:id
Fetches all events for a given user ID.

    * Calls http://event.com/getUserById/:id to retrieve user details
    * Extracts events array from the user object
    * Uses Promise.all to fetch all related events in parallel from http://event.com/getEventById/:eventId
    * Returns an array of event data

### Improvements
I was able to make a series of improvements on the overall performance and reliability of the system

1. Ensure that we were fetching all of the events for a user in parallel by resorting to promise logic and specifically Promise.all to ensure that we'd be fetching for all of the various events in parallel
2. Implemented some retry logic in the `getEvent` method to ensure that when the API was being overloaded we specifically handled retries and waited for a configurable amount of time (defaults to 500ms) before trying again
3. Added the backoff logic to not overwhelm the server for `addEvent` didn't finish in the alloted time though
