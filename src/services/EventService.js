import axios from 'axios';

/**
 * Single API Instance to be used across app, thus not spawning
 * a new instance of axios in each component.
 */

const apiClient = axios.create({
    baseURL: 'https://my-json-server.typicode.com/scottnotscott/Real-World-Vue',
    withCredentials: false,
    headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
    }
})

export default {
    getEvents() {
        return apiClient.get('/events')
    },
    getEvent(id) {
        return apiClient.get('/events/' + id)
    }
}