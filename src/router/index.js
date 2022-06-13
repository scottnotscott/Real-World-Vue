import { createRouter, createWebHistory } from "vue-router";
import EventList from "../views/EventList.vue";
import EventDetails from "../views/event/Details.vue";
import EventRegister from "../views/event/Register.vue";
import EventEdit from "../views/event/Edit.vue";
import EventLayout from "../views/event/Layout.vue";
import About from '../views/About.vue'
import NotFound from '../views/NotFound.vue'

const routes = [
  {
    path: "/",
    name: "EventList",
    component: EventList,
    props: route => ({
      page: parseInt(route.query.page) || 1
    })
  },
  {
    path: "/about",
    name: "About",
    component: About
  },
  {
    path: '/event/:id',
    name: 'EventLayout',
    props: true,
    component: EventLayout,
    children: [
      {
        path: '', // root path of parent /event/:id
        name: 'EventDetails',
        component: EventDetails
      },
      {
        path: 'register', // /event/:id/register
        name: 'EventRegister',
        component: EventRegister,
      },
      {
        path: 'edit', // /event/:id/edit
        name: 'EventEdit',
        component: EventEdit,
      },
    ]
  },
  {
    path: '/:catchAll(.*)', // matches all routes that don't match existing route
    name: 'NotFound',
    component: NotFound
  }
];

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes,
});

export default router;
