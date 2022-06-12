<template>
<h1>Events for Good</h1>
  <div class="events">
    <EventCard v-for="event in events" :key="event.id" :event="event" />
  </div>
</template>

<script>
// @ is an alias to /src
import EventCard from "@/components/EventCard.vue";
import axios from 'axios';

export default {
  name: "EventList",
  components: {
    EventCard,
  },
  data() {
    return {
      events: null
    }
  },
  created() {
    axios.get('https://my-json-server.typicode.com/scottnotscott/Real-World-Vue/events')
    .then(response => {
      this.events = response.data
    })
    .catch(error => {
      console.log('error: ', error)
    })
  }
};
</script>

<style scoped>
.events {
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>