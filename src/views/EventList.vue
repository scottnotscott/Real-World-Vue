<template>
<h1>Events for Good</h1>
  <div class="events">
    <EventCard v-for="event in events" :key="event.id" :event="event" />

    <router-link
      :to="{ name: 'EventList', query: { page: page - 1 }}"
      rel="prev"
      v-if="page != 1"
      >Prev Page
    </router-link>

    <router-link
      :to="{ name: 'EventList', query: { page: page + 1 }}"
      rel="next"
      >Next Page
    </router-link>
  </div>
</template>

<script>
// @ is an alias to /src
import EventCard from "@/components/EventCard.vue";
import EventService from '@/services/EventService.js';
import { watchEffect } from 'vue';

export default {
  name: "EventList",
  props: ['page'],
  components: {
    EventCard,
  },
  data() {
    return {
      events: null
    }
  },
  created() {
    watchEffect(() => {
      this.events = null //clears out events on page making it look immediate
      EventService.getEvents(2, this.page)
      .then(response => {
        this.events = response.data
      })
      .catch(error => {
        console.log('error: ', error)
      })
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