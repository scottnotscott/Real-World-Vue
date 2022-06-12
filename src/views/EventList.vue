<template>
<h1>Events for Good</h1>
  <div class="events">
    <EventCard v-for="event in events" :key="event.id" :event="event" />
  </div>
</template>

<script>
// @ is an alias to /src
import EventCard from "@/components/EventCard.vue";

export default {
  name: "EventList",
  components: {
    EventCard,
  },
  data() {
    return {
      events: [
        {
          id: 184832384,
          category: 'food',
          title: 'Community Gardening',
          description: 'Join us as we tend to the edible community plants.',
          location: 'Dundee City Centre',
          date: 'July 30 2022',
          time: '10:00am',
          petsAllowed: true,
          organizer: 'Fern Pollin'
        },
        {
          id: 194727239,
          category: 'sustainability',
          title: 'City Cleanup',
          description: 'Help pick up rubbish across the city.',
          location: 'Dundee City Wide',
          date: 'August 1 2022',
          time: '11:00am',
          petsAllowed: false,
          organizer: 'Hates Rubbish'
        },
        {
          id: 3848734737, 
          category: 'animal welfare',
          title: 'Big Dog Walk',
          description: 'Help your dogs make friends across the city.',
          location: 'Balgay Park, Dundee',
          date: 'August 2 2022',
          time: '12:00pm',
          petsAllowed: true,
          organizer: 'Snoop Dog'
        }
      ]
    }
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