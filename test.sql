DROP TABLE IF EXISTS routes;
CREATE TABLE routes(id integer, i integer);

INSERT INTO routes VALUES (1, 1);
INSERT INTO routes VALUES (1, 2);
INSERT INTO routes VALUES (2, 3);
INSERT INTO routes VALUES (3, 4);

DROP TABLE IF EXISTS stops;
CREATE TABLE stops(i integer, stationId integer, arrivalTime integer);

INSERT INTO stops VALUES (1, 1, 1200);
INSERT INTO stops VALUES (1, 2, 1300);
INSERT INTO stops VALUES (2, 1, 1400);
INSERT INTO stops VALUES (2, 2, 1500);
INSERT INTO stops VALUES (3, 2, 1600);
INSERT INTO stops VALUES (3, 1, 1700);
INSERT INTO stops VALUES (4, 1, 1800);
INSERT INTO stops VALUES (4, 2, 1900);

SELECT
	MAX(route.routeId) as routeId,
	routeOrigin,
	routeDestination,
	arrival.arrivalTime as arrivalTime,
	departure.departureTime as departureTime,
	arrival.platform as arrivalPlatform,
	departure.platform as departurePlatform
FROM
	route,
	stop as departure,
	stop as arrival,
	(SELECT routeId as routeOrigin, MIN(arrivalTime) FROM stop GROUP BY routeId),
	(SELECT routeId as routeDestination, MAX(arrivalTime) FROM stop GROUP BY routeId),
WHERE
	departure.routeId = route.routeId AND
	arrival.routeId = route.routeId AND
	routeOrigin = route.routeId AND
	routeDestination = route.routeId
GROUP BY
	route.atocId
HAVING
	route.dateFrom <= $date AND
	route.dateTo >= $date AND
	route.operatingDays & (1 << $day) AND
	departure.stationId = $startStation AND
	arrival.stationId = $endStation AND
	arrivalTime > departureTime AND
	arrivalTime <= $startTime AND
	departureTime >= $endTime
;
