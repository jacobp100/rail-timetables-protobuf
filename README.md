# rail-timetables-protobuf

A bunch of trials to compress offline rail timetables as much as possible. I'm pretty sure the Protobuf ObjC is what was ulitmately used.

I don't remember exactly where I got the data from, but I can tell you the last timetable added had the filename ttisf515.mca. It was a text file, and weighed in st about 300mb from memory.

The workflow was download the file, drop it in the Downloads folder (the default save location), then run `npm run build xxx` where xxx is the timetable number.

It would then generate a `ttisXXX.proto` file in the same directory.

Use the LZMA command line program to compress the `.proto` file.

Finally, drop it into the ios folder in the React Native app.

Add that file to Xcode and make sure the RailApp target is checked in the sidebar.

Next, update this line with the new filename:- https://github.com/jacobp100/RailApp/blob/master/ios/RouteReader.m#L21

To alter that workflow, you'll have to modify this code: https://github.com/jacobp100/rail-timetables-protobuf/blob/efbdabcd6232914a951eb35348471b5907d9eb47/index.js#L13
