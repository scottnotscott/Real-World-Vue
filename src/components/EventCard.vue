<template>
  <div class="event-card">
    <span>@ {{ event.time }} on {{ event.date }}</span>
    <h4>{{ event.title }}</h4>
  </div>
</template>

<script>
export default {
  name: "EventCard",
  // props: {
  //   msg: String,
  // },
  data() {
    return {
      event: {
        id: 5928101,
        category: "animal welfare",
        title: "Cat Adoption Day",
        description: "Find your new feline friend at this event.",
        location: "Meow Town",
        date: "July 30, 2022",
        time: "12:00",
        petsAllowed: true,
        organizer: "Kat Laydee",
      },
    }
  },
}
</script>

<style scoped>
.event-card {
  padding: 20px;
  width: 250px;
  cursor: pointer;
  border: 1px solid #39495c;
  margin-bottom: 18px;
}

.event-card:hover {
  transform: scale(1.01);
  box-shadow: 0 3px 12px 0 rgba(0, 0, 0, 0.2);
}
</style>
