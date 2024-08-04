# rail-timetables-protobuf

A bunch of trials to compress offline rail timetables as much as possible. I'm pretty sure the Protobuf ObjC is what was ulitmately used.

Sign into [ATOC](https://data.atoc.org/how-to), go to 'Data Download', and download the 'Timetable Feed'. The only important file is the mca file.

The workflow was download the file, drop it in the Downloads folder (the default save location), then run,

```
npm start xxx
```

Where xxx is the timetable number (excluding the ttis).

It would then generate a `ttisXXX.pr` file in the same directory.

Use the LZMA command line program to compress the `.pr` file.

```
lzma -z ttisXXX.pr
```

Finally, drop it into the ios folder in the React Native app.

Remove the numbers from the file name and replace it in the `RailApp/ios` folder.
