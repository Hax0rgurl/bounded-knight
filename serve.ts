import { createApp } from './app.ts';
const server=createApp();
server.listen(Number(process.env.PORT||0),'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
