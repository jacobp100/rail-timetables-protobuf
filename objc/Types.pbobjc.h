// Generated by the protocol buffer compiler.  DO NOT EDIT!
// source: types.proto

// This CPP symbol can be defined to use imports that match up to the framework
// imports needed when using CocoaPods.
#if !defined(GPB_USE_PROTOBUF_FRAMEWORK_IMPORTS)
 #define GPB_USE_PROTOBUF_FRAMEWORK_IMPORTS 0
#endif

#if GPB_USE_PROTOBUF_FRAMEWORK_IMPORTS
 #import <Protobuf/GPBProtocolBuffers.h>
#else
 #import "GPBProtocolBuffers.h"
#endif

#if GOOGLE_PROTOBUF_OBJC_VERSION < 30002
#error This file was generated by a newer version of protoc which is incompatible with your Protocol Buffer library sources.
#endif
#if 30002 < GOOGLE_PROTOBUF_OBJC_MIN_SUPPORTED_VERSION
#error This file was generated by an older version of protoc which is incompatible with your Protocol Buffer library sources.
#endif

// @@protoc_insertion_point(imports)

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

CF_EXTERN_C_BEGIN

@class Data_Route;
@class Data_Route_Stop;

NS_ASSUME_NONNULL_BEGIN

#pragma mark - TypesRoot

/**
 * Exposes the extension registry for this file.
 *
 * The base class provides:
 * @code
 *   + (GPBExtensionRegistry *)extensionRegistry;
 * @endcode
 * which is a @c GPBExtensionRegistry that includes all the extensions defined by
 * this file and all files that it depends on.
 **/
@interface TypesRoot : GPBRootObject
@end

#pragma mark - Data

typedef GPB_ENUM(Data_FieldNumber) {
  Data_FieldNumber_RoutesArray = 1,
};

@interface Data : GPBMessage

@property(nonatomic, readwrite, strong, null_resettable) NSMutableArray<Data_Route*> *routesArray;
/** The number of items in @c routesArray without causing the array to be created. */
@property(nonatomic, readonly) NSUInteger routesArray_Count;

@end

#pragma mark - Data_Route

typedef GPB_ENUM(Data_Route_FieldNumber) {
  Data_Route_FieldNumber_Id_p = 1,
  Data_Route_FieldNumber_Days = 2,
  Data_Route_FieldNumber_From = 3,
  Data_Route_FieldNumber_To = 4,
  Data_Route_FieldNumber_StopsArray = 5,
};

@interface Data_Route : GPBMessage

@property(nonatomic, readwrite, copy, null_resettable) NSString *id_p;

@property(nonatomic, readwrite) uint32_t days;

@property(nonatomic, readwrite) uint32_t from;

@property(nonatomic, readwrite) uint32_t to;

@property(nonatomic, readwrite, strong, null_resettable) NSMutableArray<Data_Route_Stop*> *stopsArray;
/** The number of items in @c stopsArray without causing the array to be created. */
@property(nonatomic, readonly) NSUInteger stopsArray_Count;

@end

#pragma mark - Data_Route_Stop

typedef GPB_ENUM(Data_Route_Stop_FieldNumber) {
  Data_Route_Stop_FieldNumber_StationId = 1,
  Data_Route_Stop_FieldNumber_Arrival = 2,
  Data_Route_Stop_FieldNumber_Departure = 3,
  Data_Route_Stop_FieldNumber_Platform = 4,
};

@interface Data_Route_Stop : GPBMessage

@property(nonatomic, readwrite) uint32_t stationId;

@property(nonatomic, readwrite) uint32_t arrival;

@property(nonatomic, readwrite) uint32_t departure;

@property(nonatomic, readwrite) uint32_t platform;

@end

NS_ASSUME_NONNULL_END

CF_EXTERN_C_END

#pragma clang diagnostic pop

// @@protoc_insertion_point(global_scope)
