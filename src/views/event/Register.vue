<template>
<div v-if="event">
<p>register event here</p>
<button @click="register">Register</button>
</div>
</template>

<script>

export default {
    props: ['event'],
    methods: {
        register() {
            this.$router.push({name: 'EventDetails'})
        }
    }
}
</script>