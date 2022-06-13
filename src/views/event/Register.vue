<template>
<div v-if="event">
<p>register event here</p>
<button @click="register">Register</button>
</div>
</template>

<script>

export default {
    props: ['event'],
    inject: ['GStore'],
    methods: {
        register() {

            this.GStore.flashMessage = 'You are successfully registered for ' + this.event.title

            setTimeout(() => {
                this.GStore.flashmessage = ''
            },3000)
            this.$router.push({name: 'EventDetails'})
        }
    }
}
</script>